/**
 * Ghostspere Autonomous Agent Loop
 *
 * Runs a 60-second tick that checks every armed user's schedule and signal
 * watch, dispatches tickets automatically when triggered, and logs every
 * decision to ghostspereAgentLog.
 *
 * Two trigger types:
 *   "scheduled" — the current UTC hour matches config.scheduleHour and the
 *                 user hasn't been dispatched in the last 23 hours.
 *   "signal"    — signal watch is on and at least one High-strength Ghost
 *                 Express signal exists; fires at most once per 60 min.
 *
 * Daily budget — atomicReserveDailySlot():
 *   Every dispatch attempt (scheduled, signal, or chat) must first reserve a
 *   slot via a single atomic PostgreSQL UPDATE on ghostspere_agent_config.
 *   The UPDATE increments daily_used only when daily_used < maxPerDay for the
 *   current UTC date, resetting the counter on a new date.  Because PostgreSQL
 *   locks the row before evaluating the WHERE clause, two concurrent requests
 *   can never both see budget remaining — the second one finds the row already
 *   at the cap and gets 0 RETURNING rows.  No read-then-act race is possible.
 *
 * Schedule deduplication:
 *   lastDispatchedAt is written to the DB BEFORE any evaluation or email send.
 *   This ensures a server restart or SMTP failure cannot cause the same hour
 *   to re-trigger — the persistent timestamp is the gate, not in-memory state.
 *
 * Signal cooldown persistence:
 *   The 60-minute signal cooldown is enforced by querying ghostspereAgentLog
 *   for a recent signal_dispatch entry.  There is no in-memory state; the
 *   cooldown survives server restarts correctly.
 */

import { sql, eq, desc, and, gte, inArray } from "drizzle-orm";
import { db, userSettingsTable, ghostspereAgentConfig, ghostspereAgentLog } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getPicks, getSignals, isDataStale } from "./sportsCache.js";
import { buildTicketsFromPicks } from "./picksEngine.js";
import { isSmtpConfigured, getTransport } from "./emailTransport.js";
import { buildEmailHtml, buildEmailText } from "./emailTemplate.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TicketEvaluation {
  ticketId: string;
  aiConfidence: number;
  reasoning: string;
  agentWouldSelect: boolean;
}

// ─── Atomic daily budget reservation ─────────────────────────────────────────

/**
 * Atomically reserve one dispatch slot for the user's UTC-day budget.
 *
 * Uses a single PostgreSQL UPDATE with a WHERE guard that only matches when
 * the user is below their daily cap.  PostgreSQL row-level locking ensures
 * two concurrent calls cannot both observe budget remaining — the second
 * UPDATE finds the row already at the cap and returns 0 rows.
 *
 * Returns true if the slot was reserved (caller may proceed with dispatch).
 * Returns false if the daily cap is already met (caller must skip).
 *
 * Exported for unit testing.
 */
export async function atomicReserveDailySlot(userId: string): Promise<boolean> {
  const todayUtc = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // CASE resets daily_used to 1 on a new UTC date; increments otherwise.
  // daily_used < max_per_day: references the DB COLUMN, not a caller-supplied
  // value.  If the user reduces their cap (e.g. 3 → 1) between the config read
  // and this UPDATE, the committed max_per_day enforces the new limit at commit
  // time regardless of any stale snapshot held by the caller.
  // enabled = true: if the user disarms during the OpenAI round-trip, the UPDATE
  // finds enabled=false → 0 rows → no slot consumed, no email sent.
  const result = await db.execute(sql`
    UPDATE ghostspere_agent_config
    SET
      daily_used = CASE WHEN daily_date = ${todayUtc} THEN daily_used + 1 ELSE 1 END,
      daily_date = ${todayUtc},
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND enabled = true
      AND (daily_date IS DISTINCT FROM ${todayUtc} OR daily_used < max_per_day)
    RETURNING daily_used
  `);

  return result.rows.length > 0;
}

// ─── Signal cooldown + daily slot: combined atomic claim ─────────────────────

/**
 * Pure predicate: given a nullable lastSignalDispatchAt timestamp and a
 * reference time, returns whether the 60-minute signal cooldown has expired
 * (i.e. the signal is eligible to fire).
 *
 * Exported for unit testing — no DB required.
 */
export function isSignalCooldownExpired(
  lastSignalDispatchAt: Date | null | undefined,
  nowMs: number,
): boolean {
  if (!lastSignalDispatchAt) return true;          // never fired
  return lastSignalDispatchAt.getTime() < nowMs - 60 * 60 * 1000; // older than 60 min
}

/**
 * Pure predicate: returns true when the schedule is eligible to fire —
 * i.e. the last dispatch was more than 23 hours ago (or never happened).
 * Mirrors the WHERE clause used by atomicClaimScheduleAndReserveSlot.
 * Exported for unit testing — no DB required.
 */
export function isScheduleClaimEligible(
  lastDispatchedAt: Date | null | undefined,
  nowMs: number,
): boolean {
  if (!lastDispatchedAt) return true;                     // never dispatched
  return lastDispatchedAt.getTime() < nowMs - 23 * 60 * 60 * 1000; // older than 23 hours
}

/**
 * Atomically claim the scheduled-dispatch slot AND reserve one daily budget
 * slot — in a single PostgreSQL UPDATE.
 *
 * The WHERE clause enforces two independent guards:
 *   1. Schedule dedup: last_dispatched_at IS NULL or > 23 hours ago.
 *   2. Daily budget: daily_used < maxPerDay for the current UTC date.
 *
 * Because PostgreSQL locks the row before evaluating the WHERE clause, two
 * concurrent server instances at the same schedule hour serialize:
 *   - First instance: both conditions pass → UPDATE commits →
 *     last_dispatched_at = NOW(), daily_used incremented.
 *   - Second instance: last_dispatched_at is now seconds old → 23h guard
 *     fails → 0 RETURNING rows → skip.
 *
 * Returns true if the slot was successfully claimed (caller should dispatch).
 * Returns false if either guard fails (caller must skip).
 * Exported for unit testing.
 */
export async function atomicClaimScheduleAndReserveSlot(
  userId: string,
): Promise<boolean> {
  const todayUtc = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // daily_used < max_per_day: references the DB COLUMN directly so a stale
  // caller snapshot of maxPerDay cannot allow excess dispatches when the user
  // has reduced their cap between the config read and this UPDATE.
  const result = await db.execute(sql`
    UPDATE ghostspere_agent_config
    SET
      last_dispatched_at = NOW(),
      daily_used = CASE WHEN daily_date = ${todayUtc} THEN daily_used + 1 ELSE 1 END,
      daily_date = ${todayUtc},
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND enabled = true
      AND (last_dispatched_at IS NULL OR last_dispatched_at < NOW() - INTERVAL '23 hours')
      AND (daily_date IS DISTINCT FROM ${todayUtc} OR daily_used < max_per_day)
    RETURNING daily_used
  `);

  return result.rows.length > 0;
}

/**
 * Atomically claim the signal-dispatch cooldown slot AND reserve one daily
 * budget slot — in a single PostgreSQL UPDATE.
 *
 * The WHERE clause enforces two independent guards:
 *   1. Signal cooldown: last_signal_dispatch_at IS NULL or > 60 minutes ago.
 *   2. Daily budget: daily_used < maxPerDay for the current UTC date.
 *
 * Because PostgreSQL locks the row before evaluating the WHERE clause, two
 * concurrent callers serialize at the DB level:
 *   - First caller: both conditions pass → UPDATE succeeds → last_signal_dispatch_at
 *     is now NOW() and daily_used is incremented.
 *   - Second caller (same or next tick, same row): last_signal_dispatch_at is
 *     now < 60 minutes ago → cooldown condition fails → 0 RETURNING rows → skip.
 *
 * This is the ONLY place signal eligibility is determined. Do not use a log-row
 * read (hasRecentSignalDispatch was removed — it relied on a post-dispatch write
 * which loses the race against a slow concurrent tick).
 *
 * Returns true if both slots were successfully claimed (caller should dispatch).
 * Returns false if either guard fails (caller must skip — do not dispatch).
 *
 * Exported for unit testing.
 */
export async function atomicClaimSignalAndReserveSlot(
  userId: string,
): Promise<boolean> {
  const todayUtc = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // A single UPDATE handles both guards atomically.  PostgreSQL row-level locking
  // serializes concurrent calls so neither guard can be bypassed by a race.
  // daily_used < max_per_day: references the DB COLUMN so a stale maxPerDay
  // snapshot cannot allow extra dispatches if the user reduced their cap.
  const result = await db.execute(sql`
    UPDATE ghostspere_agent_config
    SET
      last_signal_dispatch_at = NOW(),
      daily_used = CASE WHEN daily_date = ${todayUtc} THEN daily_used + 1 ELSE 1 END,
      daily_date = ${todayUtc},
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND enabled = true
      AND (last_signal_dispatch_at IS NULL
           OR last_signal_dispatch_at < NOW() - INTERVAL '60 minutes')
      AND (daily_date IS DISTINCT FROM ${todayUtc} OR daily_used < max_per_day)
    RETURNING daily_used
  `);

  return result.rows.length > 0;
}

/**
 * Pure helper: given a list of log entries and a reference timestamp, returns
 * true if any entry is a signal_dispatch within the last 60 minutes.
 * Kept for the status endpoint display; NOT used for dispatch gating.
 * Exported for unit testing (no DB required).
 */
export function hasRecentSignalInLogs(
  logs: Array<{ action: string; createdAt: Date }>,
  nowMs: number,
): boolean {
  const oneHourAgo = nowMs - 60 * 60 * 1000;
  return logs.some(
    (l) => l.action === "signal_dispatch" && l.createdAt.getTime() > oneHourAgo,
  );
}

// ─── Daily budget display (read-only, for status endpoint) ───────────────────

/**
 * Returns the remaining daily dispatch budget for display purposes.
 * NOTE: this is NOT used for gating — atomicReserveDailySlot() is the gate.
 * Do not call this before a dispatch; call atomicReserveDailySlot() instead.
 */
export async function getRemainingDailyBudget(
  userId: string,
  maxPerDay: number,
  now: Date,
): Promise<number> {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await db
    .select({ action: ghostspereAgentLog.action })
    .from(ghostspereAgentLog)
    .where(
      and(
        eq(ghostspereAgentLog.userId, userId),
        gte(ghostspereAgentLog.createdAt, todayStart),
        inArray(ghostspereAgentLog.action, [
          "scheduled_dispatch",
          "signal_dispatch",
          "chat_dispatch",
        ]),
      ),
    );
  return Math.max(0, maxPerDay - rows.length);
}

// ─── AI Evaluation ────────────────────────────────────────────────────────────

/**
 * Ask OpenAI to evaluate a list of tickets and return per-ticket confidence
 * scores (0-100) plus one-sentence reasoning. Uses gpt-4o-mini for speed/cost.
 * Falls back to pick-derived scores on any OpenAI error.
 *
 * NOTE: The returned `agentWouldSelect` field is advisory only. Server-side
 * selection ALWAYS re-enforces the threshold via `selectQualifyingTickets`.
 */
export async function evaluateTickets(
  tickets: ReturnType<typeof buildTicketsFromPicks>,
  confidenceThreshold = 75,
): Promise<TicketEvaluation[]> {
  if (tickets.length === 0) return [];

  const ticketSummaries = tickets.map((t) => ({
    id: t.id,
    sport: t.sport,
    riskTier: t.riskTier,
    entryType: t.entryType,
    combinedConfidence: t.combinedConfidence,
    payoutMultiplier: t.payoutMultiplier,
    picks: t.picks.map((p) => ({
      player: p.playerName,
      prop: p.propType,
      direction: p.direction,
      line: p.line,
      confidence: p.confidence,
      riskTier: p.riskTier,
      explanation: p.explanation,
    })),
  }));

  const systemPrompt = `You are Ghostspere, an elite AI sports betting agent. Evaluate each ticket entry and return a JSON object.

For each ticket, provide:
- aiConfidence: integer 0-100 (your overall confidence this entry will cash)
- reasoning: one sentence explaining why (cite the strongest pick or risk factor)
- agentWouldSelect: true if aiConfidence >= ${confidenceThreshold}

Respond ONLY with a valid JSON object in this format:
{
  "evaluations": [
    { "ticketId": "...", "aiConfidence": 82, "reasoning": "...", "agentWouldSelect": true },
    ...
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Evaluate these ${tickets.length} tickets:\n${JSON.stringify(ticketSummaries, null, 2)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { evaluations?: unknown[] };
    const rawEvals = Array.isArray(parsed.evaluations) ? parsed.evaluations : [];

    // Normalise and validate each entry before returning
    const knownIds = new Set(tickets.map((t) => t.id));
    const evals: TicketEvaluation[] = [];
    for (const e of rawEvals) {
      if (!e || typeof e !== "object") continue;
      const ev = e as Record<string, unknown>;
      const ticketId = typeof ev.ticketId === "string" ? ev.ticketId : null;
      if (!ticketId || !knownIds.has(ticketId)) continue; // reject unknown IDs
      const rawConf = Number(ev.aiConfidence);
      const aiConfidence = isFinite(rawConf) ? Math.max(0, Math.min(100, rawConf)) : 0;
      evals.push({
        ticketId,
        aiConfidence,
        reasoning: typeof ev.reasoning === "string" ? ev.reasoning : "",
        agentWouldSelect: aiConfidence >= confidenceThreshold, // server-enforced
      });
    }

    // Fill gaps for any tickets the model omitted
    const evalMap = new Map(evals.map((e) => [e.ticketId, e]));
    return tickets.map((t) => {
      const found = evalMap.get(t.id);
      if (found) return found;
      const fallbackConf = Math.max(0, Math.min(100, Math.round(t.combinedConfidence)));
      return {
        ticketId: t.id,
        aiConfidence: fallbackConf,
        reasoning: `${t.picks.length}-pick ${t.riskTier} entry with ${t.combinedConfidence.toFixed(0)}% combined signal strength.`,
        agentWouldSelect: fallbackConf >= confidenceThreshold,
      };
    });
  } catch (err) {
    logger.warn({ err }, "[GhostspereAgent] OpenAI evaluation failed — using fallback scores");
    return tickets.map((t) => {
      const fallbackConf = Math.max(0, Math.min(100, Math.round(t.combinedConfidence)));
      return {
        ticketId: t.id,
        aiConfidence: fallbackConf,
        reasoning: `${t.picks.length}-pick ${t.riskTier} entry with ${t.combinedConfidence.toFixed(0)}% combined signal strength.`,
        agentWouldSelect: fallbackConf >= confidenceThreshold,
      };
    });
  }
}

// ─── Ticket selection (pure, server-enforced) ─────────────────────────────────

/**
 * Select the best tickets from a model evaluation result.
 *
 * Rules:
 *   1. ticketId MUST be in knownTicketIds (live tickets from the picks cache).
 *   2. aiConfidence is clamped to [0, 100]. The model's `agentWouldSelect` is
 *      IGNORED — the server re-enforces the threshold independently.
 *   3. Results are sorted by descending aiConfidence and capped at maxCount.
 *
 * Exported for unit testing.
 */
export function selectQualifyingTickets(
  evaluations: TicketEvaluation[],
  knownTicketIds: Set<string>,
  confidenceThreshold: number,
  maxCount: number,
): TicketEvaluation[] {
  return evaluations
    .filter((e) => {
      if (!knownTicketIds.has(e.ticketId)) return false;
      // Use !isNaN so Infinity clamps to 100: Math.min(100, Infinity) = 100
      const conf =
        typeof e.aiConfidence === "number" && !isNaN(e.aiConfidence)
          ? Math.max(0, Math.min(100, e.aiConfidence))
          : 0;
      return conf >= confidenceThreshold;
    })
    .map((e) => ({
      ...e,
      aiConfidence:
        typeof e.aiConfidence === "number" && !isNaN(e.aiConfidence)
          ? Math.max(0, Math.min(100, e.aiConfidence))
          : 0,
      agentWouldSelect:
        (typeof e.aiConfidence === "number" && !isNaN(e.aiConfidence)
          ? Math.max(0, Math.min(100, e.aiConfidence))
          : 0) >= confidenceThreshold,
    }))
    .sort((a, b) => b.aiConfidence - a.aiConfidence)
    .slice(0, maxCount);
}

// ─── Chat dispatch helpers ────────────────────────────────────────────────────

/**
 * Hard upper limit on tickets per single chat-dispatched email.
 * Prevents the model from inflating this beyond a safe value.
 */
export const CHAT_DISPATCH_SERVER_CAP = 5;

/**
 * Clamp a model-supplied maxTickets value to a safe positive integer.
 *
 * - Non-numeric, NaN, Infinity, ≤0 values fall back to serverCap.
 * - Result is always in [1, min(raw, serverCap)].
 *
 * Exported for unit testing.
 */
export function clampChatMaxTickets(raw: unknown, serverCap: number): number {
  if (serverCap <= 0) return 0;
  const n = Number(raw);
  const validated = isFinite(n) && n > 0 ? Math.floor(n) : serverCap;
  return Math.min(validated, serverCap);
}

// ─── Chat Intent Parser ────────────────────────────────────────────────────────

export type AgentChatAction =
  | { type: "dispatch_now"; maxTickets?: number }
  | { type: "update_config"; patch: Partial<{ enabled: boolean; scheduleHour: number; confidenceThreshold: number; signalWatchEnabled: boolean }> }
  | { type: "arm"; enabled: boolean }
  | { type: "none" };

/**
 * Parse a user message into a structured action + human-readable reply.
 * The caller MUST sanitize numeric fields in `patch` before applying them.
 */
export async function parseAgentChatIntent(
  message: string,
  context: { config: any; recentLog: any[]; ticketCount: number },
): Promise<{ action: AgentChatAction; reply: string }> {
  const systemPrompt = `You are the Ghostspere autonomous agent. The user is giving you a command.

Current state:
- Agent armed: ${context.config?.enabled ?? false}
- Schedule hour (UTC): ${context.config?.scheduleHour ?? 8}:00
- Confidence threshold: ${context.config?.confidenceThreshold ?? 75}%
- Signal watch: ${context.config?.signalWatchEnabled ?? true}
- Available tickets: ${context.ticketCount}
- Recent actions: ${context.recentLog.slice(0, 3).map((l: any) => l.action + ': ' + l.reason).join(' | ') || 'none yet'}

Available actions you can take:
1. dispatch_now — immediately dispatch the best tickets to the user's email
2. arm (enabled: true/false) — arm or disarm the autonomous agent
3. update_config — change scheduleHour (0-23), confidenceThreshold (50-99), or signalWatchEnabled
4. none — just answer the question, no action needed

Respond with ONLY a JSON object:
{
  "action": { "type": "dispatch_now|arm|update_config|none", ...params },
  "reply": "Your conversational response to the user (1-3 sentences, direct and data-driven)"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { action?: AgentChatAction; reply?: string };
    return {
      action: parsed.action ?? { type: "none" },
      reply: parsed.reply ?? "Acknowledged.",
    };
  } catch (err) {
    logger.warn({ err }, "[GhostspereAgent] Chat intent parse failed");
    return { action: { type: "none" }, reply: "Signal lost — could not parse your command. Try again." };
  }
}

// ─── Core Dispatch ────────────────────────────────────────────────────────────

/**
 * Evaluate the user's current tickets, select those above the threshold,
 * dispatch them via email, and log the result.
 *
 * CALLER CONTRACT:
 *   - Call atomicReserveDailySlot() BEFORE calling this function.  If it
 *     returns false, do NOT call this function.
 *   - For schedule triggers, also update lastDispatchedAt BEFORE calling.
 *
 * This function always logs an entry (dispatched or skipped) so the daily
 * budget counter reflects the attempt even when SMTP or OpenAI fails.
 */
export async function runAgentDispatch(
  userId: string,
  triggerType: "scheduled_dispatch" | "signal_dispatch" | "chat_dispatch",
  triggerReason: string,
  confidenceThreshold: number,
  maxDispatch: number,
): Promise<{ dispatched: number; evaluations: TicketEvaluation[] }> {
  // Hard guard: never email mock or stale data.  isDataStale() returns true
  // when the API key is absent (demo mode) or the cache has not refreshed
  // within the staleness window.  This is checked here too (not only in the
  // tick) so chat-triggered dispatches are equally guarded.
  if (isDataStale()) {
    await logAction(
      userId,
      triggerType,
      "Dispatch suppressed — picks cache is mock or stale. Arm the agent after configuring THE_ODDS_API_KEY.",
      [],
      null,
      0,
    );
    return { dispatched: 0, evaluations: [] };
  }

  const settingsRows = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const settings = settingsRows[0];
  if (!settings?.email) {
    await logAction(userId, triggerType, "No delivery address configured — set email in Ghostspere settings.", [], null, 0);
    return { dispatched: 0, evaluations: [] };
  }

  const picksPerTicket = settings.picksPerTicket ? Math.min(6, Math.max(2, Number(settings.picksPerTicket))) : 3;
  const riskProfile = (settings.riskProfile ?? "Balanced") as "Safe" | "Balanced" | "Aggressive" | "Mixed";
  const entryType = (settings.entryType ?? "PowerPlay") as "PowerPlay" | "FlexPlay";

  const allTickets = buildTicketsFromPicks(getPicks(), picksPerTicket, riskProfile, entryType);

  if (allTickets.length === 0) {
    await logAction(userId, triggerType, "No tickets available in current picks cache.", [], null, 0);
    return { dispatched: 0, evaluations: [] };
  }

  const evaluations = await evaluateTickets(allTickets, confidenceThreshold);

  const knownTicketIds = new Set(allTickets.map((t) => t.id));
  const selected = selectQualifyingTickets(evaluations, knownTicketIds, confidenceThreshold, maxDispatch);

  if (selected.length === 0) {
    const validConfs = evaluations
      .filter((e) => knownTicketIds.has(e.ticketId))
      .map((e) => e.aiConfidence);
    const maxConf = validConfs.length > 0 ? Math.max(...validConfs) : 0;
    await logAction(
      userId,
      triggerType,
      `No tickets above ${confidenceThreshold}% threshold (best was ${maxConf.toFixed(0)}%).`,
      [],
      evaluations[0]?.reasoning ?? null,
      0,
    );
    return { dispatched: 0, evaluations };
  }

  const selectedIds = new Set(selected.map((e) => e.ticketId));
  const ticketsToSend = allTickets.filter((t) => selectedIds.has(t.id));
  const aiReasoning = selected.map((e) => e.reasoning).join(" | ");

  // Re-authorize immediately before the irreversible send boundary.
  // The atomic slot claim above runs before the OpenAI evaluation round-trip
  // (which can take several seconds). If the user disarms during that window
  // the claim still succeeds but we must not send the email.
  // We re-read enabled from the DB here — at the last possible moment — so
  // the window between this check and the SMTP call is a single local function
  // call (microseconds). Any disarm committed before this point is caught;
  // any disarm committed after is indistinguishable from a disarm sent one
  // millisecond after delivery (which is also acceptable: the user pressed
  // "Disarm" after the system had already started sending).
  const [reAuthRow] = await db
    .select({ enabled: ghostspereAgentConfig.enabled })
    .from(ghostspereAgentConfig)
    .where(eq(ghostspereAgentConfig.userId, userId))
    .limit(1);

  if (!reAuthRow?.enabled) {
    await logAction(
      userId,
      triggerType,
      "Dispatch suppressed — agent was disarmed during evaluation (re-authorization check before send).",
      [],
      null,
      0,
    );
    return { dispatched: 0, evaluations };
  }

  if (!isSmtpConfigured()) {
    await logAction(
      userId,
      triggerType,
      `${triggerReason} [SMTP not configured — email skipped]`,
      selected.map((e) => e.ticketId),
      aiReasoning,
      0,
    );
    return { dispatched: 0, evaluations };
  }

  try {
    const transport = getTransport();
    const fromAddress = process.env["SMTP_FROM"] ?? `Ghostspere Agent <${process.env["SMTP_USER"]}>`;
    const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    await transport.sendMail({
      from: fromAddress,
      to: settings.email,
      subject: `👻 Ghostspere Agent — ${ticketsToSend.length} Auto-Dispatched Entry${ticketsToSend.length !== 1 ? "ies" : ""} — ${dateLabel}`,
      text: buildEmailText(ticketsToSend),
      html: buildEmailHtml(ticketsToSend, settings.email),
    });

    await logAction(userId, triggerType, triggerReason, selected.map((e) => e.ticketId), aiReasoning, ticketsToSend.length);
    logger.info({ userId, count: ticketsToSend.length, to: settings.email, trigger: triggerType }, "[GhostspereAgent] Auto-dispatched entries");
    return { dispatched: ticketsToSend.length, evaluations };
  } catch (err) {
    // SMTP failure: still log using the triggerType so the slot counts against daily budget
    const msg = err instanceof Error ? err.message : String(err);
    await logAction(userId, triggerType, `${triggerReason} — email send failed: ${msg}`, selected.map((e) => e.ticketId), aiReasoning, 0);
    logger.error({ err, userId }, "[GhostspereAgent] Email dispatch failed");
    return { dispatched: 0, evaluations };
  }
}

async function logAction(
  userId: string,
  action: string,
  reason: string,
  ticketIds: string[],
  aiReasoning: string | null,
  dispatchCount: number,
): Promise<void> {
  await db.insert(ghostspereAgentLog).values({
    userId,
    action,
    reason,
    ticketIds: ticketIds.length > 0 ? JSON.stringify(ticketIds) : null,
    aiReasoning,
    dispatchCount,
  });
}

// ─── Compute next run time ────────────────────────────────────────────────────

export function computeNextRunAt(scheduleHour: number): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(scheduleHour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export function startAgentLoop(): void {
  logger.info("[GhostspereAgent] Autonomous agent loop started (60s tick)");

  setInterval(async () => {
    try {
      await runAgentTick();
    } catch (err) {
      logger.error({ err }, "[GhostspereAgent] Tick error — continuing");
    }
  }, 60_000);
}

async function runAgentTick(): Promise<void> {
  // Guard: never dispatch when picks are mock data or stale.
  // isDataStale() returns true when (a) THE_ODDS_API_KEY is not set (demo/mock
  // mode) or (b) the last successful refresh was more than PICKS_STALENESS_MINUTES
  // ago. This prevents automated betting emails based on 2024 demo data or an
  // outdated API snapshot at startup before the first refresh completes.
  if (isDataStale()) {
    logger.debug("[GhostspereAgent] Tick skipped — picks cache is mock or stale");
    return;
  }

  const now = new Date();
  const currentUtcHour = now.getUTCHours();

  const configs = await db
    .select()
    .from(ghostspereAgentConfig)
    .where(eq(ghostspereAgentConfig.enabled, true));

  if (configs.length === 0) return;

  const signals = getSignals();
  const hasHighSignal = Object.values(signals).some((sigs) =>
    sigs.some((s) => s.strength === "High"),
  );

  for (const config of configs) {
    try {
      const userId = config.userId;

      // ─── Schedule trigger ────────────────────────────────────────────────────
      // Pre-filter: only attempt the atomic claim during the configured hour.
      // The snapshot check is a cheap local guard; the atomic UPDATE is the
      // authoritative dedup for concurrent server instances.
      const isScheduleHour = currentUtcHour === config.scheduleHour;

      if (isScheduleHour) {
        // Atomically claim the schedule slot AND reserve a daily budget slot.
        // The UPDATE's WHERE clause enforces: last_dispatched_at IS NULL OR
        // last_dispatched_at < NOW() - INTERVAL '23 hours', so two concurrent
        // instances serializing on this row can never both succeed.
        const claimed = await atomicClaimScheduleAndReserveSlot(userId);
        if (claimed) {
          logger.info({ userId, hour: currentUtcHour }, "[GhostspereAgent] Schedule trigger firing");
          await runAgentDispatch(
            userId,
            "scheduled_dispatch",
            `Scheduled daily dispatch at ${currentUtcHour}:00 UTC`,
            config.confidenceThreshold,
            config.maxPerDay,
          );
        }
        // If not claimed: either just dispatched (<23h), budget exhausted,
        // or concurrent instance already claimed this slot — all silent skips.
        // Do NOT continue here: signal watch evaluates independently so a
        // High signal during the schedule hour still dispatches when the
        // schedule slot was unavailable (budget exhausted or already ran).
      }

      // ─── Signal watch trigger ────────────────────────────────────────────────
      if (config.signalWatchEnabled && hasHighSignal) {
        // Atomically claim the 60-minute signal cooldown slot AND a daily budget
        // slot in a single PostgreSQL UPDATE.  Both guards are checked under the
        // same row lock — two concurrent or overlapping ticks cannot both succeed:
        // the first commits last_signal_dispatch_at = NOW(), so the second's WHERE
        // fails the cooldown predicate and returns 0 rows.
        const claimed = await atomicClaimSignalAndReserveSlot(userId);
        if (claimed) {
          logger.info({ userId }, "[GhostspereAgent] Signal watch trigger firing");
          await runAgentDispatch(
            userId,
            "signal_dispatch",
            "High-strength Ghost Express signal detected",
            config.confidenceThreshold,
            2, // signal dispatches cap at 2 tickets per email
          );
        }
      }
    } catch (err) {
      logger.warn({ err, userId: config.userId }, "[GhostspereAgent] Error processing user tick — skipping");
    }
  }
}

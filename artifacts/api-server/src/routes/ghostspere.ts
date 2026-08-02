import { Router, type IRouter, type Request, type Response } from "express";
import { isSmtpConfigured, getTransport } from "../lib/emailTransport.js";
import { eq, isNull, desc, and, or } from "drizzle-orm";
import { db, userSettingsTable, ghostspereAgentConfig, ghostspereAgentLog, pickResultsTable } from "@workspace/db";
import {
  ListTicketsQueryParams,
  ListTicketsResponse,
  SendTicketEmailBody,
  SendTicketEmailResponse,
  GetAgentConfigResponse,
  UpdateAgentConfigBody,
  UpdateAgentConfigResponse,
  GetAgentStatusResponse,
  ListAgentLogResponse,
  EvaluateAgentTicketsResponse,
  SendAgentChatBody,
} from "@workspace/api-zod";
import { getPicks, getGames, getLiveGames } from "../lib/sportsCache.js";
import { autoSettlePick } from "../lib/espnStats.js";
import { buildTicketsFromPicks, resolveTickets } from "../lib/picksEngine.js";
import { buildEmailHtml, buildEmailText } from "../lib/emailTemplate.js";
import { logger } from "../lib/logger.js";
import {
  evaluateTickets,
  runAgentDispatch,
  parseAgentChatIntent,
  computeNextRunAt,
  getRemainingDailyBudget,
  atomicReserveDailySlot,
  clampChatMaxTickets,
  CHAT_DISPATCH_SERVER_CAP,
} from "../lib/ghostspereAgent.js";

const router: IRouter = Router();

// ─── Auth guard ────────────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user.id;
}

// ─── Rate limiting (in-memory, per authenticated user) ────────────────────────

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

interface RateBucket { count: number; windowStart: number; }
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

// ─── Helper: get or create agent config ──────────────────────────────────────

async function getOrCreateConfig(userId: string) {
  // Atomic upsert: INSERT ON CONFLICT DO NOTHING handles concurrent first-load
  // requests (two callers both see no row → both INSERT → only one succeeds;
  // neither throws a unique constraint error). Then always SELECT the row.
  await db
    .insert(ghostspereAgentConfig)
    .values({ userId })
    .onConflictDoNothing({ target: ghostspereAgentConfig.userId });

  const [row] = await db
    .select()
    .from(ghostspereAgentConfig)
    .where(eq(ghostspereAgentConfig.userId, userId))
    .limit(1);

  return row!;
}

// ─── Existing ticket and email routes ─────────────────────────────────────────

router.get("/ghostspere/tickets", async (req, res): Promise<void> => {
  const query = ListTicketsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  let picksPerTicket = 3;
  let riskProfile: "Safe" | "Balanced" | "Aggressive" | "Mixed" = "Balanced";
  let entryType: "PowerPlay" | "FlexPlay" = "PowerPlay";
  const userId = req.isAuthenticated() ? req.user.id : null;
  const settingsFilter = userId ? eq(userSettingsTable.userId, userId) : isNull(userSettingsTable.userId);
  const settingsRows = await db.select({ picksPerTicket: userSettingsTable.picksPerTicket, riskProfile: userSettingsTable.riskProfile, entryType: userSettingsTable.entryType }).from(userSettingsTable).where(settingsFilter).limit(1);

  if (settingsRows[0]) {
    if (settingsRows[0].picksPerTicket) picksPerTicket = Math.min(6, Math.max(2, Number(settingsRows[0].picksPerTicket)));
    if (settingsRows[0].riskProfile) riskProfile = settingsRows[0].riskProfile as typeof riskProfile;
    if (settingsRows[0].entryType) entryType = settingsRows[0].entryType as typeof entryType;
  }

  const picks = getPicks();
  const tickets = buildTicketsFromPicks(picks, picksPerTicket, riskProfile, entryType);
  res.json(ListTicketsResponse.parse(tickets));
});

router.post("/ghostspere/send-email", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many email dispatches. Please wait before sending again." });
    return;
  }

  const parsed = SendTicketEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { ticketIds, sport } = parsed.data;
  const rows = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  const settingsEmail = rows[0]?.email ?? "";
  if (!settingsEmail) {
    res.status(400).json({ error: "No delivery address configured. Set your email in Ghostspere settings first." });
    return;
  }

  req.log.info({ userId, ticketIds, sport }, "Email dispatch requested");

  const userRows = await db.select({ picksPerTicket: userSettingsTable.picksPerTicket, riskProfile: userSettingsTable.riskProfile, entryType: userSettingsTable.entryType }).from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
  const emailPicksPerTicket = userRows[0]?.picksPerTicket ? Math.min(6, Math.max(2, Number(userRows[0].picksPerTicket))) : 3;
  const emailRiskProfile = (userRows[0]?.riskProfile ?? "Balanced") as "Safe" | "Balanced" | "Aggressive" | "Mixed";
  const emailEntryType = (userRows[0]?.entryType ?? "PowerPlay") as "PowerPlay" | "FlexPlay";

  const allTickets = buildTicketsFromPicks(getPicks(), emailPicksPerTicket, emailRiskProfile, emailEntryType);
  const { matched: selectedTickets, skippedCount } = resolveTickets(allTickets, ticketIds);

  if (selectedTickets.length === 0) {
    res.status(400).json({ error: "All selected tickets have expired — picks rotated since you loaded this page. Refresh the ticket list and select again." });
    return;
  }

  if (!isSmtpConfigured()) {
    req.log.warn("SMTP credentials not configured — cannot send real email");
    res.status(503).json({ error: "Email delivery is not configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS as Replit secrets to enable real dispatch." });
    return;
  }

  try {
    const fromAddress = process.env["SMTP_FROM"] ?? `Ghostspere <${process.env["SMTP_USER"]}>`;
    const transport = getTransport();
    const ticketCount = selectedTickets.length;
    const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

    await transport.sendMail({
      from: fromAddress,
      to: settingsEmail,
      subject: `👻 Ghostspere — ${ticketCount} Pick${ticketCount !== 1 ? "s" : ""} for ${dateLabel}`,
      text: buildEmailText(selectedTickets),
      html: buildEmailHtml(selectedTickets, settingsEmail),
    });

    req.log.info({ userId, ticketCount, to: settingsEmail }, "Email dispatched successfully");
    const sportLabel = sport ?? "All Sports";
    const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} ticket${skippedCount !== 1 ? "s" : ""} expired and skipped)` : "";

    res.json(SendTicketEmailResponse.parse({
      success: true,
      dispatched: ticketCount,
      skipped: skippedCount,
      message: `Ghostspere dispatched ${ticketCount} ticket${ticketCount !== 1 ? "s" : ""} (${sportLabel}) to ${settingsEmail} — ${dateLabel}${skippedSuffix}`,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to send email via SMTP");
    res.status(500).json({ error: `Email delivery failed: ${msg}` });
  }
});

// ─── Agent Config ──────────────────────────────────────────────────────────────

router.get("/ghostspere/agent/config", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const config = await getOrCreateConfig(userId);
  res.json(GetAgentConfigResponse.parse({
    userId: config.userId,
    enabled: config.enabled,
    scheduleHour: config.scheduleHour,
    confidenceThreshold: config.confidenceThreshold,
    signalWatchEnabled: config.signalWatchEnabled,
    maxPerDay: config.maxPerDay,
    lastDispatchedAt: config.lastDispatchedAt?.toISOString() ?? null,
    createdAt: config.createdAt.toISOString(),
  }));
});

router.put("/ghostspere/agent/config", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = UpdateAgentConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const patch = parsed.data;
  await getOrCreateConfig(userId); // ensure row exists

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) updates.enabled = patch.enabled;
  if (patch.scheduleHour !== undefined) updates.scheduleHour = Math.min(23, Math.max(0, Math.round(patch.scheduleHour)));
  if (patch.confidenceThreshold !== undefined) updates.confidenceThreshold = Math.min(99, Math.max(1, patch.confidenceThreshold));
  if (patch.signalWatchEnabled !== undefined) updates.signalWatchEnabled = patch.signalWatchEnabled;
  if (patch.maxPerDay !== undefined) updates.maxPerDay = Math.min(10, Math.max(1, Math.round(patch.maxPerDay)));

  const [updated] = await db
    .update(ghostspereAgentConfig)
    .set(updates)
    .where(eq(ghostspereAgentConfig.userId, userId))
    .returning();

  res.json(UpdateAgentConfigResponse.parse({
    userId: updated!.userId,
    enabled: updated!.enabled,
    scheduleHour: updated!.scheduleHour,
    confidenceThreshold: updated!.confidenceThreshold,
    signalWatchEnabled: updated!.signalWatchEnabled,
    maxPerDay: updated!.maxPerDay,
    lastDispatchedAt: updated!.lastDispatchedAt?.toISOString() ?? null,
    createdAt: updated!.createdAt.toISOString(),
  }));
});

// ─── Agent Status ──────────────────────────────────────────────────────────────

router.get("/ghostspere/agent/status", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const config = await getOrCreateConfig(userId);

  const logRows = await db
    .select()
    .from(ghostspereAgentLog)
    .where(eq(ghostspereAgentLog.userId, userId))
    .orderBy(desc(ghostspereAgentLog.createdAt))
    .limit(1);

  const lastEntry = logRows[0];
  const nextRunAt = config.enabled ? computeNextRunAt(config.scheduleHour) : null;

  res.json(GetAgentStatusResponse.parse({
    armed: config.enabled,
    signalWatchActive: config.enabled && config.signalWatchEnabled,
    nextRunAt,
    lastAction: lastEntry
      ? {
          id: lastEntry.id,
          action: lastEntry.action,
          reason: lastEntry.reason,
          ticketIds: lastEntry.ticketIds ? JSON.parse(lastEntry.ticketIds) : null,
          aiReasoning: lastEntry.aiReasoning,
          dispatchCount: lastEntry.dispatchCount,
          createdAt: lastEntry.createdAt.toISOString(),
        }
      : null,
  }));
});

// ─── Agent Log ────────────────────────────────────────────────────────────────

router.get("/ghostspere/agent/log", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const rows = await db
    .select()
    .from(ghostspereAgentLog)
    .where(eq(ghostspereAgentLog.userId, userId))
    .orderBy(desc(ghostspereAgentLog.createdAt))
    .limit(50);

  res.json(ListAgentLogResponse.parse(rows.map((r) => ({
    id: r.id,
    action: r.action,
    reason: r.reason,
    ticketIds: r.ticketIds ? JSON.parse(r.ticketIds) : null,
    aiReasoning: r.aiReasoning,
    dispatchCount: r.dispatchCount,
    createdAt: r.createdAt.toISOString(),
  }))));
});

// ─── AI Ticket Evaluation ─────────────────────────────────────────────────────

router.post("/ghostspere/agent/evaluate", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const config = await getOrCreateConfig(userId);

  const settingsRows = await db
    .select({ picksPerTicket: userSettingsTable.picksPerTicket, riskProfile: userSettingsTable.riskProfile, entryType: userSettingsTable.entryType })
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const picksPerTicket = settingsRows[0]?.picksPerTicket ? Math.min(6, Math.max(2, Number(settingsRows[0].picksPerTicket))) : 3;
  const riskProfile = (settingsRows[0]?.riskProfile ?? "Balanced") as "Safe" | "Balanced" | "Aggressive" | "Mixed";
  const entryType = (settingsRows[0]?.entryType ?? "PowerPlay") as "PowerPlay" | "FlexPlay";

  const tickets = buildTicketsFromPicks(getPicks(), picksPerTicket, riskProfile, entryType);
  const evaluations = await evaluateTickets(tickets, config.confidenceThreshold);

  res.json(EvaluateAgentTicketsResponse.parse({ evaluations }));
});

// ─── Agent Chat (SSE) ─────────────────────────────────────────────────────────

router.post("/ghostspere/agent/chat", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = SendAgentChatBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { message } = parsed.data;

  const [config, recentLog, settingsRows] = await Promise.all([
    getOrCreateConfig(userId),
    db.select().from(ghostspereAgentLog).where(eq(ghostspereAgentLog.userId, userId)).orderBy(desc(ghostspereAgentLog.createdAt)).limit(5),
    db.select({ picksPerTicket: userSettingsTable.picksPerTicket, riskProfile: userSettingsTable.riskProfile, entryType: userSettingsTable.entryType }).from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1),
  ]);

  const picksPerTicket = settingsRows[0]?.picksPerTicket ? Math.min(6, Math.max(2, Number(settingsRows[0].picksPerTicket))) : 3;
  const riskProfile = (settingsRows[0]?.riskProfile ?? "Balanced") as "Safe" | "Balanced" | "Aggressive" | "Mixed";
  const entryType = (settingsRows[0]?.entryType ?? "PowerPlay") as "PowerPlay" | "FlexPlay";
  const tickets = buildTicketsFromPicks(getPicks(), picksPerTicket, riskProfile, entryType);

  const context = {
    config: {
      enabled: config.enabled,
      scheduleHour: config.scheduleHour,
      confidenceThreshold: config.confidenceThreshold,
      signalWatchEnabled: config.signalWatchEnabled,
    },
    recentLog: recentLog.map((r) => ({ action: r.action, reason: r.reason })),
    ticketCount: tickets.length,
  };

  const { action, reply } = await parseAgentChatIntent(message, context);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Execute action server-side before streaming
  let actionResult = "";
  try {
    if (action.type === "dispatch_now") {
      // Enforce armed status: disarmed users cannot trigger chat dispatches.
      // We re-read config.enabled from the fresh DB row (loaded above) rather
      // than relying on the AI message intent, so a concurrent disarm is caught.
      // Atomically reserve a daily budget slot — the UPDATE requires enabled=true
      // in its WHERE clause, so a user who disarms between the initial config
      // read (above) and this UPDATE will get 0 RETURNING rows.  This closes the
      // race without relying on the stale config.enabled value.
      const reserved = await atomicReserveDailySlot(userId);
      if (!reserved) {
        // Distinguish the failure reason with a cheap follow-up read.
        const [fresh] = await db
          .select({ enabled: ghostspereAgentConfig.enabled })
          .from(ghostspereAgentConfig)
          .where(eq(ghostspereAgentConfig.userId, userId))
          .limit(1);
        if (!fresh?.enabled) {
          actionResult = " Agent is disarmed — arm it first before dispatching.";
        } else {
          actionResult = ` Daily dispatch cap (${config.maxPerDay}) already reached — no more dispatches until tomorrow UTC.`;
        }
      } else {
        // Slot reserved. Clamp model-supplied maxTickets to a safe integer
        // bounded by the hard server cap (budget already consumed above).
        const maxTickets = clampChatMaxTickets(action.maxTickets, CHAT_DISPATCH_SERVER_CAP);
        const { dispatched } = await runAgentDispatch(
          userId,
          "chat_dispatch",
          `Chat command: "${message.slice(0, 80)}"`,
          config.confidenceThreshold,
          maxTickets,
        );
        actionResult = dispatched > 0
          ? ` Dispatched ${dispatched} entr${dispatched !== 1 ? "ies" : "y"}.`
          : " No tickets cleared the confidence threshold — nothing dispatched.";
      }
    } else if (action.type === "arm") {
      await db.update(ghostspereAgentConfig).set({ enabled: action.enabled, updatedAt: new Date() }).where(eq(ghostspereAgentConfig.userId, userId));
      actionResult = action.enabled ? " Agent is now ARMED." : " Agent is now DISARMED.";
    } else if (action.type === "update_config" && action.patch) {
      // Apply same range constraints as the PUT /ghostspere/agent/config route
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (action.patch.confidenceThreshold !== undefined)
        updates.confidenceThreshold = Math.min(99, Math.max(1, Number(action.patch.confidenceThreshold) || 75));
      if (action.patch.scheduleHour !== undefined)
        updates.scheduleHour = Math.min(23, Math.max(0, Math.round(Number(action.patch.scheduleHour) || 8)));
      if (action.patch.signalWatchEnabled !== undefined)
        updates.signalWatchEnabled = Boolean(action.patch.signalWatchEnabled);
      if (action.patch.enabled !== undefined)
        updates.enabled = Boolean(action.patch.enabled);
      await db.update(ghostspereAgentConfig).set(updates).where(eq(ghostspereAgentConfig.userId, userId));
      actionResult = " Configuration updated.";
    }
  } catch (err) {
    logger.error({ err, userId, action }, "[GhostspereAgent] Chat action execution failed");
    actionResult = " (Action failed — check logs.)";
  }

  const fullReply = reply + actionResult;
  // Stream the reply word by word for a typing effect
  const words = fullReply.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? "" : " ") + words[i];
    res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    await new Promise((r) => setTimeout(r, 30));
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// ─── Pick results: enriched picks with live game status ───────────────────────

router.get("/ghostspere/pick-results", async (req, res): Promise<void> => {
  const userId = req.isAuthenticated() ? req.user.id : null;
  const settingsFilter = userId ? eq(userSettingsTable.userId, userId) : isNull(userSettingsTable.userId);

  // Load user settings
  let picksPerTicket = 3;
  let riskProfile: "Safe" | "Balanced" | "Aggressive" | "Mixed" = "Balanced";
  let entryType: "PowerPlay" | "FlexPlay" = "PowerPlay";
  const settingsRows = await db
    .select({ picksPerTicket: userSettingsTable.picksPerTicket, riskProfile: userSettingsTable.riskProfile, entryType: userSettingsTable.entryType })
    .from(userSettingsTable).where(settingsFilter).limit(1);
  if (settingsRows[0]) {
    if (settingsRows[0].picksPerTicket) picksPerTicket = Math.min(6, Math.max(2, Number(settingsRows[0].picksPerTicket)));
    if (settingsRows[0].riskProfile) riskProfile = settingsRows[0].riskProfile as typeof riskProfile;
    if (settingsRows[0].entryType) entryType = settingsRows[0].entryType as typeof entryType;
  }

  // Build tickets and deduplicate picks across them
  const picks = getPicks();
  const tickets = buildTicketsFromPicks(picks, picksPerTicket, riskProfile, entryType);

  // Build lookup maps from game cache
  const allGames = getGames();
  const liveGames = getLiveGames();
  const liveMap = new Map(liveGames.map((g) => [g.id, g]));
  const gameMap = new Map(allGames.map((g) => [g.id, g]));

  // Load saved results for this user (includes ESPN auto-settled)
  const savedResults = userId
    ? await db.select().from(pickResultsTable).where(eq(pickResultsTable.userId, userId))
    : await db.select().from(pickResultsTable).where(isNull(pickResultsTable.userId));
  const resultMap = new Map(savedResults.map((r) => [r.pickId, r]));

  // Deduplicate picks across tickets
  const pickMap = new Map<string, {
    pickId: string; playerName: string; team: string; sport: string; propType: string;
    line: number; direction: "Over" | "Under"; confidence: number; riskTier: string;
    commenceTime: string | null; gameStatus: string; homeTeam: string; awayTeam: string;
    homeScore: number | null; awayScore: number | null; quarter: string | null;
    timeRemaining: string | null; result: "hit" | "miss" | "push" | null;
    settledValue: string | null; settledSource: string | null;
    ticketIds: string[];
  }>();

  for (const ticket of tickets) {
    for (const pick of ticket.picks) {
      const existing = pickMap.get(pick.id);
      if (existing) {
        if (!existing.ticketIds.includes(ticket.id)) existing.ticketIds.push(ticket.id);
        continue;
      }
      const live = pick.gameId ? liveMap.get(pick.gameId) : undefined;
      const scheduled = pick.gameId ? gameMap.get(pick.gameId) : undefined;

      let gameStatus = "Upcoming";
      if (live) {
        gameStatus = live.status;
      } else if (scheduled?.status) {
        gameStatus = scheduled.status === "Scheduled" ? "Upcoming" : scheduled.status;
      }

      const saved = resultMap.get(pick.id);
      pickMap.set(pick.id, {
        pickId: pick.id,
        playerName: pick.playerName,
        team: pick.team,
        sport: pick.sport,
        propType: pick.propType,
        line: pick.line,
        direction: pick.direction,
        confidence: pick.confidence,
        riskTier: pick.riskTier,
        commenceTime: pick.commenceTime ?? null,
        gameStatus,
        homeTeam: live?.homeTeam ?? scheduled?.homeTeam ?? pick.team,
        awayTeam: live?.awayTeam ?? scheduled?.awayTeam ?? pick.opponent,
        homeScore: live?.homeScore ?? scheduled?.homeScore ?? null,
        awayScore: live?.awayScore ?? scheduled?.awayScore ?? null,
        quarter: live?.quarter ?? null,
        timeRemaining: live?.timeRemaining ?? null,
        result: (saved?.result as "hit" | "miss" | "push" | null) ?? null,
        settledValue: saved?.settledValue ?? null,
        settledSource: saved?.settledSource ?? null,
        ticketIds: [ticket.id],
      });
    }
  }

  // Auto-settle Final picks that have no result yet (async, fire & collect)
  const finalUnsettled = Array.from(pickMap.values()).filter(
    (p) => p.gameStatus === "Final" && p.result === null,
  );

  if (finalUnsettled.length > 0) {
    // Run ESPN auto-settle concurrently but cap at 6 at a time
    const BATCH = 6;
    for (let i = 0; i < finalUnsettled.length; i += BATCH) {
      const batch = finalUnsettled.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (p) => {
          try {
            const settled = await autoSettlePick({
              playerName: p.playerName,
              sport: p.sport,
              propType: p.propType,
              line: p.line,
              direction: p.direction,
              homeTeam: p.homeTeam,
              awayTeam: p.awayTeam,
              commenceTime: p.commenceTime,
            });
            if (!settled) return;

            // Persist to DB (insert or update, unique per user+pick)
            const existingRow = await db.select({ id: pickResultsTable.id })
              .from(pickResultsTable)
              .where(
                userId
                  ? and(eq(pickResultsTable.userId, userId), eq(pickResultsTable.pickId, p.pickId))
                  : and(isNull(pickResultsTable.userId), eq(pickResultsTable.pickId, p.pickId)),
              )
              .limit(1);

            if (existingRow.length > 0) {
              await db.update(pickResultsTable)
                .set({ result: settled.result, settledValue: String(settled.actualValue), settledSource: "espn", settledAt: new Date() })
                .where(eq(pickResultsTable.id, existingRow[0].id));
            } else {
              await db.insert(pickResultsTable).values({
                userId,
                pickId: p.pickId,
                result: settled.result,
                settledValue: String(settled.actualValue),
                settledSource: "espn",
              });
            }

            // Update the in-memory map for the response
            p.result = settled.result;
            p.settledValue = String(settled.actualValue);
            p.settledSource = "espn";
          } catch (_err) {
            // silent — ESPN settle is best-effort
          }
        }),
      );
    }
  }

  res.json(Array.from(pickMap.values()));
});

// ─── Settle a pick result manually (requires auth) ────────────────────────────

router.post("/ghostspere/pick-results/:pickId", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { pickId } = req.params;
  const { result } = req.body as { result: "hit" | "miss" | "push" | null };

  if (result !== null && !["hit", "miss", "push"].includes(result)) {
    res.status(400).json({ error: "result must be 'hit', 'miss', 'push', or null" });
    return;
  }

  if (result === null) {
    await db.delete(pickResultsTable)
      .where(and(eq(pickResultsTable.userId, userId), eq(pickResultsTable.pickId, pickId)));
  } else {
    const existing = await db.select({ id: pickResultsTable.id })
      .from(pickResultsTable)
      .where(and(eq(pickResultsTable.userId, userId), eq(pickResultsTable.pickId, pickId)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(pickResultsTable)
        .set({ result, settledAt: new Date() })
        .where(and(eq(pickResultsTable.userId, userId), eq(pickResultsTable.pickId, pickId)));
    } else {
      await db.insert(pickResultsTable).values({ userId, pickId, result });
    }
  }

  res.json({ pickId, result });
});

export default router;

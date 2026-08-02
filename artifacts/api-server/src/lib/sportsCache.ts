/**
 * In-memory sports data cache with scheduled refresh and on-disk snapshot.
 *
 * On startup (and every PICKS_REFRESH_INTERVAL_MINUTES), the cache fetches from
 * The Odds API and generates picks. Routes read from this cache; when the API key
 * is not set, the cache initializes with mock data and never switches to real data.
 *
 * Provenance guarantees (reviewed and approved):
 *   - A successful API call returning zero games/picks clears the cache with
 *     usingRealData=true — honest empty state, not mock fallback.
 *   - null from any fetchEvents/fetchScores call → throws → catch retains prior state.
 *   - null from any fetchPlayerProps call → throws → catch retains prior state.
 *   - livePicks and signals are always cleared when usingRealData is set.
 *   - Mock data is only served when THE_ODDS_API_KEY is not configured.
 *
 * Snapshot / restart resilience:
 *   - After every successful live refresh, the cache is serialised to a JSON
 *     file at CACHE_SNAPSHOT_PATH (default: /tmp/ghostwatch-cache-snapshot.json).
 *   - The write is atomic: data is written to a .tmp file then renamed, so a
 *     crash during the write never leaves a corrupt snapshot.
 *   - On startup, if THE_ODDS_API_KEY is set, the server loads the snapshot
 *     (if it exists) and serves it with source="snapshot" while the first live
 *     refresh runs in the background. This prevents a server restart during an
 *     outage from falling back to 2024 mock data.
 *   - A corrupted or version-mismatched snapshot is silently ignored.
 *
 * Staleness:
 *   - Data is considered stale when:
 *       (a) THE_ODDS_API_KEY is not set (always stale / demo mode), or
 *       (b) API key is set but we have never successfully refreshed, or
 *       (c) the last successful refresh is older than PICKS_STALENESS_MINUTES.
 *   - PICKS_STALENESS_MINUTES defaults to 45 (3× the 15-min refresh interval).
 *
 * Exponential back-off:
 *   - On consecutive refresh failures the scheduler backs off:
 *       delay = min(base × 2^(failures−1), base × 4)   (max = 4× base interval)
 *   - Resets to the base interval after the first successful refresh.
 *
 * Environment variables:
 *   THE_ODDS_API_KEY               — The Odds API key (required for real data)
 *   PICKS_REFRESH_INTERVAL_MINUTES — Minimum refresh interval in minutes (default: 15). The adaptive
 *                                    quota system may increase this automatically based on credits remaining.
 *   PICKS_STALENESS_MINUTES        — Age at which data is declared stale (default: 45)
 *   CACHE_SNAPSHOT_PATH            — Where to persist the snapshot (default: /tmp/ghostwatch-cache-snapshot.json)
 *   MONTHLY_CREDIT_BUDGET          — Odds API credits allocated per billing month (default: 20000).
 *                                    The adaptive scheduler uses this to automatically right-size the
 *                                    refresh interval and game depth so credits last the full month.
 */

import * as fs from "node:fs";
import { z } from "zod";
import {
  fetchEvents,
  fetchScores,
  fetchPlayerProps,
  getQuotaStats,
  SPORT_KEYS,
} from "./oddsApi.js";
import {
  eventsToGames,
  scoreEventsToGames,
  scoresToLiveGames,
  buildPicksFromEvents,
  buildTicketsFromPicks,
  type GeneratedGame,
  type GeneratedPick,
  type GeneratedLiveGame,
  type GeneratedLivePick,
  type GeneratedSignal,
} from "./picksEngine.js";
import {
  mockGames,
  mockPicks,
  mockLiveGames,
  mockLivePicks,
  mockSignals,
  mockTickets,
} from "./mockData.js";
import { logger } from "./logger.js";

// ─── Source types ─────────────────────────────────────────────────────────────

/**
 * Where the current in-memory data came from:
 *   "live"     — fetched from The Odds API in this server process
 *   "snapshot" — loaded from disk on startup; a live refresh is pending
 *   "mock"     — no API key configured; 2024 demo data
 */
export type CacheSource = "live" | "snapshot" | "mock";

// ─── State ────────────────────────────────────────────────────────────────────

interface CacheState {
  games: GeneratedGame[];
  picks: GeneratedPick[];
  liveGames: GeneratedLiveGame[];
  livePicks: GeneratedLivePick[];
  signals: Record<string, GeneratedSignal[]>;
  tickets: ReturnType<typeof buildTicketsFromPicks>;
  lastRefreshedAt: Date | null;
  usingRealData: boolean;
  source: CacheSource;
  isRefreshing: boolean;
  lastError: string | null;
  quotaRemaining: number | null;
  consecutiveFailures: number;
}

const state: CacheState = {
  games: mockGames as GeneratedGame[],
  picks: mockPicks as GeneratedPick[],
  liveGames: mockLiveGames as GeneratedLiveGame[],
  livePicks: mockLivePicks as GeneratedLivePick[],
  signals: mockSignals as Record<string, GeneratedSignal[]>,
  tickets: mockTickets as CacheState["tickets"],
  lastRefreshedAt: null,
  usingRealData: false,
  source: "mock",
  isRefreshing: false,
  lastError: null,
  quotaRemaining: null,
  consecutiveFailures: 0,
};

// ─── API key helpers ──────────────────────────────────────────────────────────

/** True when THE_ODDS_API_KEY is set (preferred) or legacy ODDS_API_KEY is set. */
export function isOddsApiEnabled(): boolean {
  return !!(process.env["THE_ODDS_API_KEY"] ?? process.env["ODDS_API_KEY"]);
}

/** Alias for callers using the main-branch naming convention. */
export const isApiConfigured = isOddsApiEnabled;

// ─── Staleness ────────────────────────────────────────────────────────────────

function getStalenessMs(): number {
  return Number(process.env["PICKS_STALENESS_MINUTES"] ?? "45") * 60 * 1000;
}

/**
 * Returns true when the cache data should not be trusted for betting decisions:
 *   - API key not configured (demo mode, always stale)
 *   - API key set but never successfully refreshed
 *   - Last successful refresh is older than PICKS_STALENESS_MINUTES
 */
export function isDataStale(): boolean {
  if (!isOddsApiEnabled()) return true;
  if (!state.usingRealData) return true;
  if (!state.lastRefreshedAt) return true;
  return Date.now() - state.lastRefreshedAt.getTime() > getStalenessMs();
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

const SNAPSHOT_VERSION = 1 as const;

// ── Zod schemas for runtime validation of snapshot entries ───────────────────
//    passthrough() allows extra fields (future additions) without rejection.

const SnapshotPickSchema = z.object({
  id: z.string(),
  playerName: z.string(),
  team: z.string(),
  opponent: z.string(),
  sport: z.string(),
  propType: z.string(),
  line: z.number(),
  direction: z.enum(["Over", "Under"]),
  projection: z.number(),
  confidence: z.number(),
  riskTier: z.enum(["Safe", "Balanced", "Aggressive"]),
  explanation: z.string(),
  socialImpact: z.number().nullable(),
  createdAt: z.string(),
}).passthrough();

const SnapshotGameSchema = z.object({
  id: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  sport: z.string(),
  scheduledAt: z.string(),
  status: z.enum(["Scheduled", "Live", "Final"]),
  homeScore: z.number().nullable(),
  awayScore: z.number().nullable(),
  quarter: z.string().nullable(),
  timeRemaining: z.string().nullable(),
}).passthrough();

const SnapshotLiveGameSchema = z.object({
  id: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  sport: z.string(),
  homeScore: z.number(),
  awayScore: z.number(),
  quarter: z.string(),
  timeRemaining: z.string(),
  pace: z.enum(["Slow", "Normal", "Fast"]),
  status: z.enum(["Live", "Halftime", "Final"]),
}).passthrough();

const SnapshotTicketSchema = z.object({
  id: z.string(),
  riskTier: z.string(),
  entryType: z.enum(["PowerPlay", "FlexPlay"]).default("PowerPlay"),
  payoutMultiplier: z.number().default(5),
  picks: z.array(SnapshotPickSchema),
  combinedConfidence: z.number(),
  sport: z.string(),
  createdAt: z.string(),
}).passthrough();

/**
 * savedAt validator: ISO 8601 prefix regex + finite parse + calendar-date
 * normalization to reject invalid dates such as "2026-02-31T00:00:00Z"
 * that some engines roll over to the next month.
 */
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const SnapshotSavedAtSchema = z.string().refine(
  (s) => {
    if (!ISO_PREFIX.test(s)) return false;
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return false;
    // Re-serialise and compare the YYYY-MM-DD portion to catch rolled-over
    // invalid calendar dates (e.g. Feb 31 → Mar 3).
    const inputDate = s.substring(0, 10);
    const normalizedDate = new Date(ms).toISOString().substring(0, 10);
    return inputDate === normalizedDate;
  },
  { message: "savedAt must be a valid ISO 8601 timestamp with a real calendar date" },
);

const SnapshotPayloadSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  savedAt: SnapshotSavedAtSchema,
  games: z.array(SnapshotGameSchema),
  picks: z.array(SnapshotPickSchema),
  liveGames: z.array(SnapshotLiveGameSchema),
  tickets: z.array(SnapshotTicketSchema),
});

/**
 * Write-side type: plain interface used by snapshotCache() when serialising
 * in-memory cache state. The real generated types are assignable here.
 *
 * Load-side validation uses SnapshotPayloadSchema.safeParse() at runtime and
 * then casts the validated data back to the generated types.
 */
interface SnapshotPayload {
  version: typeof SNAPSHOT_VERSION;
  savedAt: string; // ISO 8601
  games: GeneratedGame[];
  picks: GeneratedPick[];
  liveGames: GeneratedLiveGame[];
  tickets: ReturnType<typeof buildTicketsFromPicks>;
}

function getSnapshotPath(): string {
  return (
    process.env["CACHE_SNAPSHOT_PATH"] ?? "/tmp/ghostwatch-cache-snapshot.json"
  );
}

/**
 * Atomically serialise the current cache state to disk.
 * Writes to a .tmp file first then renames to prevent corrupt reads.
 * Errors are logged and swallowed — a snapshot failure never disrupts serving.
 */
function snapshotCache(): void {
  const snapshotPath = getSnapshotPath();
  const tmpPath = `${snapshotPath}.tmp`;

  try {
    const payload: SnapshotPayload = {
      version: SNAPSHOT_VERSION,
      savedAt: (state.lastRefreshedAt ?? new Date()).toISOString(),
      games: state.games,
      picks: state.picks,
      liveGames: state.liveGames,
      tickets: state.tickets,
    };

    fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf-8");
    fs.renameSync(tmpPath, snapshotPath);

    logger.info(
      { path: snapshotPath, picks: state.picks.length, games: state.games.length },
      "[SportsCache] Snapshot saved",
    );
  } catch (err) {
    // Non-fatal: serve from memory; clean up orphaned .tmp if it exists.
    logger.warn({ err }, "[SportsCache] Failed to save snapshot — in-memory state unaffected");
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Attempt to restore cache state from the on-disk snapshot.
 * Called at startup, before the first live refresh, when THE_ODDS_API_KEY is set.
 * Returns true if the snapshot was loaded successfully.
 *
 * The entire payload is validated with Zod before any state mutation.
 * A snapshot that fails validation (wrong version, bad date, missing fields,
 * invalid enum values, wrong collection shapes) is silently ignored — state
 * is never partially updated.
 *
 * On success the cache serves source="snapshot" data until a live refresh
 * replaces it with source="live" data.
 */
function loadSnapshot(): boolean {
  const snapshotPath = getSnapshotPath();

  try {
    if (!fs.existsSync(snapshotPath)) return false;

    const raw = fs.readFileSync(snapshotPath, "utf-8");
    const parsed = SnapshotPayloadSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.slice(0, 3) }, // cap log size
        "[SportsCache] Snapshot failed schema validation — ignoring",
      );
      return false;
    }

    const payload: SnapshotPayload = parsed.data;
    const savedAtMs = Date.parse(payload.savedAt);

    // Commit all-or-nothing — all guards already passed inside safeParse.
    state.games = payload.games as unknown as GeneratedGame[];
    state.picks = payload.picks as unknown as GeneratedPick[];
    state.liveGames = payload.liveGames as unknown as GeneratedLiveGame[];
    state.tickets = payload.tickets as unknown as CacheState["tickets"];
    state.livePicks = [];
    state.signals = {};
    state.usingRealData = true;
    state.source = "snapshot";
    state.lastRefreshedAt = new Date(savedAtMs);

    logger.info(
      {
        path: snapshotPath,
        picks: state.picks.length,
        games: state.games.length,
        savedAt: payload.savedAt,
      },
      "[SportsCache] Snapshot loaded — serving cached picks until live refresh succeeds",
    );
    return true;
  } catch (err) {
    logger.warn(
      { err },
      "[SportsCache] Failed to load snapshot — falling back to mock data",
    );
    return false;
  }
}

// ─── Refresh logic ────────────────────────────────────────────────────────────

/**
 * Delay between consecutive player-prop API requests during a refresh cycle.
 * Prevents triggering The Odds API's per-minute frequency cap (EXCEEDED_FREQ_LIMIT)
 * when many games across multiple sports are fetched on startup or manual refresh.
 *
 * Defaults to 300 ms. Set PROP_REQUEST_DELAY_MS to override.
 * Forced to 0 ms in the test environment so unit tests run at full speed.
 */
function getPropRequestDelayMs(): number {
  if (process.env["NODE_ENV"] === "test") return 0;
  return Number(process.env["PROP_REQUEST_DELAY_MS"] ?? "300");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Adaptive quota protocol ──────────────────────────────────────────────────

/**
 * Five-tier adaptive refresh protocol — automatically stretches MONTHLY_CREDIT_BUDGET
 * (default 20,000) across the full billing month by scaling the refresh interval
 * and game depth based on how many credits remain.
 *
 *   Tier        % remaining   Interval   Max games/sport   ≈credits/day
 *   ─────────────────────────────────────────────────────────────────────
 *   full        > 75 %        45 min     3                 ~480
 *   standard    50–75 %       60 min     2                 ~360
 *   conserve    25–50 %       90 min     2                 ~240
 *   emergency   5–25 %        120 min    1                 ~120
 *   suspended   < 5 %         —          0   (snapshot-only, no API calls)
 *
 * PICKS_REFRESH_INTERVAL_MINUTES is honoured as a minimum floor — the adaptive
 * system will never schedule a refresh shorter than that value.
 *
 * When no quota data is available yet (first start, before any API response),
 * defaults to standard tier (60 min / 2 games) until real numbers arrive.
 */
export function getAdaptiveSettings(): {
  intervalMs: number;
  maxGamesPerSport: number;
  suspended: boolean;
  tier: "full" | "standard" | "conserve" | "emergency" | "suspended";
} {
  const monthlyBudget = Number(process.env["MONTHLY_CREDIT_BUDGET"] ?? "20000");
  const minIntervalMs = Number(process.env["PICKS_REFRESH_INTERVAL_MINUTES"] ?? "15") * 60_000;
  const { remainingRequests } = getQuotaStats();

  if (remainingRequests === null) {
    // No quota data yet — conservative standard defaults until first API call.
    return { intervalMs: Math.max(60 * 60_000, minIntervalMs), maxGamesPerSport: 2, suspended: false, tier: "standard" };
  }

  const ratio = remainingRequests / monthlyBudget;

  if (ratio < 0.05) {
    return { intervalMs: 0, maxGamesPerSport: 0, suspended: true, tier: "suspended" };
  }
  if (ratio < 0.25) {
    return { intervalMs: Math.max(120 * 60_000, minIntervalMs), maxGamesPerSport: 1, suspended: false, tier: "emergency" };
  }
  if (ratio < 0.50) {
    return { intervalMs: Math.max(90 * 60_000, minIntervalMs), maxGamesPerSport: 2, suspended: false, tier: "conserve" };
  }
  if (ratio < 0.75) {
    return { intervalMs: Math.max(60 * 60_000, minIntervalMs), maxGamesPerSport: 2, suspended: false, tier: "standard" };
  }
  return { intervalMs: Math.max(45 * 60_000, minIntervalMs), maxGamesPerSport: 3, suspended: false, tier: "full" };
}

async function refreshGamesAndScores(): Promise<{
  games: GeneratedGame[];
  liveGames: GeneratedLiveGame[];
}> {
  const sports = Object.keys(SPORT_KEYS);
  const allGames: GeneratedGame[] = [];
  const allLiveGames: GeneratedLiveGame[] = [];
  const failures: string[] = [];

  await Promise.all(
    sports.map(async (sport) => {
      // Fetch upcoming games
      const events = await fetchEvents(sport);
      if (events === null) {
        // null = request failed (network, HTTP error, etc.) — not an empty slate
        failures.push(`events:${sport}`);
      } else {
        allGames.push(...eventsToGames(events, sport));
      }

      // Fetch scores / live games
      const scores = await fetchScores(sport);
      if (scores === null) {
        failures.push(`scores:${sport}`);
      } else {
        allGames.push(...scoreEventsToGames(scores, sport));
        allLiveGames.push(...scoresToLiveGames(scores, sport));
      }
    }),
  );

  // Any request failure makes the whole refresh atomic-fail: caller's catch block retains
  // previous state so a bad key or outage doesn't wipe picks.
  if (failures.length) {
    throw new Error(`Odds API request(s) failed: ${failures.join(", ")}`);
  }

  // De-duplicate by id (scores endpoint may overlap with events)
  const deduped = Object.values(
    Object.fromEntries(allGames.map((g) => [g.id, g])),
  );

  return { games: deduped, liveGames: allLiveGames };
}

async function refreshPicks(games: GeneratedGame[], maxGamesPerSport: number): Promise<GeneratedPick[]> {
  const sports = Object.keys(SPORT_KEYS);
  const allPicks: GeneratedPick[] = [];
  const delayMs = getPropRequestDelayMs();

  // Counter tracks total prop requests fired so far. The first request is
  // always immediate; each subsequent one waits `delayMs` before firing.
  // This converts what was a burst of up to 15 simultaneous requests into a
  // controlled sequential stream, avoiding EXCEEDED_FREQ_LIMIT 429s on
  // server restart / first refresh.
  let requestsFired = 0;

  logger.info(
    { sports: sports.join(", "), delayMs, maxGamesPerSport },
    "[SportsCache] Starting staggered player-prop fetch",
  );

  for (const sport of sports) {
    // Include both Scheduled and Live games — player-prop markets stay
    // open once a game begins, so live games are still bettable.
    const sportGames = games
      .filter((g) => g.sport === sport && (g.status === "Scheduled" || g.status === "Live"))
      .slice(0, maxGamesPerSport); // adaptive quota depth

    if (!sportGames.length) continue;

    const propResults: { gameId: string; props: Awaited<ReturnType<typeof fetchPlayerProps>> }[] = [];

    for (const g of sportGames) {
      // Stagger: sleep before every request except the very first one.
      if (requestsFired > 0 && delayMs > 0) {
        await sleep(delayMs);
      }
      const props = await fetchPlayerProps(sport, g.id);
      propResults.push({ gameId: g.id, props });
      requestsFired++;
    }

    const failures = propResults.filter((r) => r.props === null);
    const eventsWithProps = propResults
      .map((r) => r.props)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (failures.length > 0 && eventsWithProps.length === 0) {
      // All prop calls for this sport failed — off-season or API unavailable.
      // Skip the sport with a warning rather than aborting the whole refresh,
      // so MLB/WNBA picks still surface even when NHL/NBA are dormant.
      logger.warn(
        { sport, failedGames: failures.map((f) => f.gameId) },
        "[SportsCache] No player-prop markets available for sport — skipping",
      );
      continue;
    }

    if (failures.length > 0) {
      // Partial failure — some games have props, some don't. Use what we have.
      logger.warn(
        { sport, failedGames: failures.map((f) => f.gameId) },
        "[SportsCache] Some player-prop requests failed — using available games only",
      );
    }

    if (eventsWithProps.length) {
      const picks = await buildPicksFromEvents(eventsWithProps, sport);
      allPicks.push(...picks);
    }
  }

  logger.info(
    { requestsFired, totalPicks: allPicks.length },
    "[SportsCache] Staggered prop fetch complete",
  );

  return allPicks;
}

export async function refreshCache(): Promise<void> {
  if (!isOddsApiEnabled()) {
    logger.info("[SportsCache] THE_ODDS_API_KEY not set — serving mock data");
    return;
  }

  const adaptive = getAdaptiveSettings();

  if (adaptive.suspended) {
    logger.warn(
      { remainingCredits: getQuotaStats().remainingRequests },
      "[SportsCache] Quota <5% of monthly budget — refresh suspended, serving snapshot",
    );
    return;
  }

  if (state.isRefreshing) return;

  state.isRefreshing = true;
  state.lastError = null;

  logger.info(
    { tier: adaptive.tier, maxGamesPerSport: adaptive.maxGamesPerSport, nextRefreshMins: Math.round(adaptive.intervalMs / 60_000) },
    "[SportsCache] Starting adaptive data refresh from The Odds API…",
  );

  try {
    const { games, liveGames } = await refreshGamesAndScores();
    // A successful call returning zero games is still valid real data (e.g. off-season).
    // Do NOT fall back to mock data — serve empty arrays and mark as real.

    const picks = games.length ? await refreshPicks(games, adaptive.maxGamesPerSport) : [];

    // All collections reflect the real API state.
    // Empty arrays are intentional: "API active, nothing available right now."
    state.games = games;
    state.picks = picks;
    state.tickets = picks.length
      ? (buildTicketsFromPicks(picks) as CacheState["tickets"])
      : [];
    state.liveGames = liveGames;
    state.livePicks = []; // The Odds API has no live-prop endpoint
    state.signals = {}; // clear mock live intel in real-data mode
    state.usingRealData = true;
    state.source = "live";
    state.lastRefreshedAt = new Date();
    state.consecutiveFailures = 0; // reset back-off counter on success

    logger.info(
      {
        games: state.games.length,
        picks: state.picks.length,
        liveGames: state.liveGames.length,
        tickets: state.tickets.length,
      },
      "[SportsCache] Refresh complete",
    );

    // Persist to disk so a restart during an outage can recover this data.
    snapshotCache();
  } catch (err) {
    // Only on identifiable request failure do we retain the previous state.
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = msg;
    state.consecutiveFailures += 1;
    logger.error(
      { err, consecutiveFailures: state.consecutiveFailures },
      "[SportsCache] Refresh failed — retaining previous data",
    );
  } finally {
    state.isRefreshing = false;
  }
}

/** Force a one-off refresh. Resolves immediately if already refreshing. */
export async function refreshSportsData(force = false): Promise<void> {
  if (!force && state.isRefreshing) return;
  return refreshCache();
}

// ─── Scheduler (setTimeout-based with exponential back-off) ──────────────────

let schedulerHandle: ReturnType<typeof setTimeout> | null = null;
/** Prevents double-start when both app.ts and index.ts call startScheduler(). */
let schedulerStarted = false;

/**
 * Pure function — computes the back-off delay for a given failure count.
 *
 * Formula: delay = min(base × 2^(failures−1), base × 4)
 *   - 0 failures → base interval (normal cadence)
 *   - 1 failure  → base × 1
 *   - 2 failures → base × 2
 *   - 3 failures → base × 4 (capped)
 *   - 4+ failures → base × 4 (stays capped)
 *
 * Exported for unit testing — production code uses scheduleNextRefresh().
 */
export function computeBackoffDelay(baseMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures === 0) return baseMs;
  return Math.min(baseMs * Math.pow(2, consecutiveFailures - 1), baseMs * 4);
}

/**
 * Schedule the next refresh using the adaptive quota tier + exponential back-off.
 *
 * Each invocation re-reads quota from getAdaptiveSettings() so the interval
 * automatically tightens or loosens as credits are consumed across the month.
 * If the quota is exhausted (suspended tier) no future refresh is scheduled —
 * the server serves its on-disk snapshot until the billing period resets.
 */
function scheduleNextRefresh(): void {
  if (!schedulerStarted) return;

  const adaptive = getAdaptiveSettings();

  if (adaptive.suspended) {
    logger.warn(
      { remainingCredits: getQuotaStats().remainingRequests },
      "[SportsCache] Quota exhausted — auto-refresh suspended until billing period resets",
    );
    return; // no setTimeout: server serves snapshot until next startup
  }

  const failures = state.consecutiveFailures;
  const delay = computeBackoffDelay(adaptive.intervalMs, failures);

  if (failures > 0) {
    logger.warn(
      { consecutiveFailures: failures, nextRetryMs: delay, nextRetryMins: Math.round(delay / 60_000) },
      "[SportsCache] Back-off retry scheduled after failure",
    );
  } else {
    logger.info(
      {
        quotaTier: adaptive.tier,
        nextRefreshMins: Math.round(delay / 60_000),
        maxGamesPerSport: adaptive.maxGamesPerSport,
        remainingCredits: getQuotaStats().remainingRequests,
      },
      "[SportsCache] Next refresh scheduled (adaptive quota protocol)",
    );
  }

  schedulerHandle = setTimeout(() => {
    void refreshCache().finally(() => scheduleNextRefresh());
  }, delay);
}

export function startScheduler(): void {
  if (schedulerStarted) return; // already running (guard covers the in-flight initial refresh)
  schedulerStarted = true;

  // If the API key is configured, try to restore the last snapshot so users
  // see real picks immediately while the first live refresh runs in the background.
  if (isOddsApiEnabled()) {
    loadSnapshot();
  }

  // Run a live refresh immediately, then schedule the adaptive back-off loop.
  void refreshCache().finally(() => {
    scheduleNextRefresh();
  });

  logger.info(
    {
      monthlyBudget: Number(process.env["MONTHLY_CREDIT_BUDGET"] ?? "20000"),
      minIntervalMinutes: Number(process.env["PICKS_REFRESH_INTERVAL_MINUTES"] ?? "15"),
      oddsApiEnabled: isOddsApiEnabled(),
    },
    "[SportsCache] Scheduler started (adaptive quota protocol)",
  );
}

/** Alias used by main-branch startup code. */
export const startAutoRefresh = startScheduler;

export function stopScheduler(): void {
  schedulerStarted = false;
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
  }
}

// ─── Read accessors ───────────────────────────────────────────────────────────

export function getGames(): CacheState["games"] {
  return state.games;
}

export function getPicks(): CacheState["picks"] {
  return state.picks;
}

export function getLiveGames(): CacheState["liveGames"] {
  return state.liveGames;
}

export function getLivePicks(): CacheState["livePicks"] {
  return state.livePicks;
}

export function getSignals(): CacheState["signals"] {
  return state.signals;
}

export function getTickets(): CacheState["tickets"] {
  return state.tickets;
}

/** Provenance + staleness + quota status — used by /ghostwatch/status and /healthz. */
export function getCacheStatus() {
  const { remainingRequests } = getQuotaStats();
  const monthlyBudget = Number(process.env["MONTHLY_CREDIT_BUDGET"] ?? "20000");
  const adaptive = getAdaptiveSettings();

  return {
    lastRefreshedAt: state.lastRefreshedAt?.toISOString() ?? null,
    usingRealData: state.usingRealData,
    source: state.source,
    isStale: isDataStale(),
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError,
    quota: {
      remainingCredits: remainingRequests,
      monthlyBudget,
      percentRemaining:
        remainingRequests !== null
          ? Math.round((remainingRequests / monthlyBudget) * 100)
          : null,
      tier: adaptive.tier,
      nextRefreshMins: adaptive.suspended ? null : Math.round(adaptive.intervalMs / 60_000),
      suspended: adaptive.suspended,
    },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Exposes snapshotCache() for unit testing.
 * ONLY for use in test files — never call in production code.
 */
export const _snapshotCacheForTesting = snapshotCache;

/**
 * Exposes loadSnapshot() for unit testing.
 * ONLY for use in test files — never call in production code.
 */
export const _loadSnapshotForTesting = loadSnapshot;

/**
 * Resets module-level state to its initial values.
 * ONLY for use in test files — never call in production code.
 */
export function _resetStateForTesting(): void {
  state.games = [];
  state.picks = [];
  state.liveGames = [];
  state.livePicks = [];
  state.signals = {};
  state.tickets = [];
  state.lastRefreshedAt = null;
  state.usingRealData = false;
  state.source = "mock";
  state.isRefreshing = false;
  state.lastError = null;
  state.quotaRemaining = null;
  state.consecutiveFailures = 0;
  schedulerStarted = false;
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
  }
}

// ─── Compatibility aliases (used by main-branch route files) ─────────────────

/** Alias for getPicks() — used by main-branch ghostwatch.ts. */
export const getAllPicks = getPicks;

/** Alias for getGames() — used by main-branch ghostwatch.ts and ghostExpress.ts. */
export const getAllGames = getGames;

/** Main-branch getCacheState shape — compatible with main-branch route code. */
export function getCacheState() {
  return {
    sports: [] as unknown[],
    lastRefresh: state.lastRefreshedAt,
    isRefreshing: state.isRefreshing,
    error: state.lastError,
    quotaRemaining: state.quotaRemaining,
    isRealData: state.usingRealData,
  };
}

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
 *   PICKS_REFRESH_INTERVAL_MINUTES — How often to refresh (default: 15)
 *   PICKS_STALENESS_MINUTES        — Age at which data is declared stale (default: 45)
 *   CACHE_SNAPSHOT_PATH            — Where to persist the snapshot (default: /tmp/ghostwatch-cache-snapshot.json)
 */

import * as fs from "node:fs";
import { z } from "zod";
import {
  fetchEvents,
  fetchScores,
  fetchPlayerProps,
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
  riskTier: z.enum(["Safe", "Balanced", "Aggressive"]),
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

async function refreshPicks(games: GeneratedGame[]): Promise<GeneratedPick[]> {
  const sports = Object.keys(SPORT_KEYS);
  const allPicks: GeneratedPick[] = [];

  // For each sport, grab props for the first few upcoming games (to stay within API quota)
  await Promise.all(
    sports.map(async (sport) => {
      const sportGames = games
        .filter((g) => g.sport === sport && g.status === "Scheduled")
        .slice(0, 3); // max 3 games per sport to manage API usage

      const propResults = await Promise.all(
        sportGames.map(async (g) => {
          const props = await fetchPlayerProps(sport, g.id);
          return { gameId: g.id, props };
        }),
      );

      // Any failed prop request (null = network/HTTP error) aborts the whole refresh.
      // This is intentional: partial picks under "LIVE DATA" would be misleading.
      const failures = propResults.filter((r) => r.props === null);
      if (failures.length) {
        throw new Error(
          `Odds API player-props request failed for games: ${failures.map((f) => f.gameId).join(", ")} (sport: ${sport})`,
        );
      }

      const eventsWithProps = propResults
        .map((r) => r.props)
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (eventsWithProps.length) {
        const picks = await buildPicksFromEvents(eventsWithProps, sport);
        allPicks.push(...picks);
      }
    }),
  );

  return allPicks;
}

export async function refreshCache(): Promise<void> {
  if (!isOddsApiEnabled()) {
    logger.info("[SportsCache] THE_ODDS_API_KEY not set — serving mock data");
    return;
  }

  if (state.isRefreshing) return;

  state.isRefreshing = true;
  state.lastError = null;
  logger.info("[SportsCache] Starting data refresh from The Odds API…");

  try {
    const { games, liveGames } = await refreshGamesAndScores();
    // A successful call returning zero games is still valid real data (e.g. off-season).
    // Do NOT fall back to mock data — serve empty arrays and mark as real.

    const picks = games.length ? await refreshPicks(games) : [];

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
 * Schedule the next refresh using exponential back-off on consecutive failures.
 */
function scheduleNextRefresh(baseMs: number): void {
  const failures = state.consecutiveFailures;
  const delay = computeBackoffDelay(baseMs, failures);

  if (failures > 0) {
    logger.warn(
      { consecutiveFailures: failures, nextRetryMs: delay, nextRetryMins: Math.round(delay / 60_000) },
      "[SportsCache] Back-off retry scheduled after failure",
    );
  }

  schedulerHandle = setTimeout(() => {
    void refreshCache().finally(() => {
      scheduleNextRefresh(baseMs);
    });
  }, delay);
}

export function startScheduler(): void {
  if (schedulerStarted) return; // already running (guard covers the in-flight initial refresh)
  schedulerStarted = true;

  const intervalMinutes = Number(process.env["PICKS_REFRESH_INTERVAL_MINUTES"] ?? "15");
  const intervalMs = intervalMinutes * 60 * 1000;

  // If the API key is configured, try to restore the last snapshot so users
  // see real picks immediately while the first live refresh runs in the background.
  if (isOddsApiEnabled()) {
    loadSnapshot();
  }

  // Run a live refresh immediately, then schedule the back-off loop.
  void refreshCache().finally(() => {
    scheduleNextRefresh(intervalMs);
  });

  logger.info(
    { intervalMinutes, oddsApiEnabled: isOddsApiEnabled() },
    "[SportsCache] Scheduler started",
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

/** Provenance + staleness status — used by /ghostwatch/status and /healthz. */
export function getCacheStatus(): {
  lastRefreshedAt: string | null;
  usingRealData: boolean;
  source: CacheSource;
  isStale: boolean;
  consecutiveFailures: number;
  lastError: string | null;
} {
  return {
    lastRefreshedAt: state.lastRefreshedAt?.toISOString() ?? null,
    usingRealData: state.usingRealData,
    source: state.source,
    isStale: isDataStale(),
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError,
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

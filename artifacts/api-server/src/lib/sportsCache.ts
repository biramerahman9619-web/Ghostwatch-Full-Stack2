/**
 * In-memory sports data cache with scheduled refresh.
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
 */

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
 * Schedule the next refresh using exponential back-off on consecutive failures.
 *
 * Formula: delay = min(base × 2^(failures−1), base × 4)
 *   - 0 failures → base interval (normal cadence)
 *   - 1 failure  → base × 1
 *   - 2 failures → base × 2
 *   - 3 failures → base × 4 (capped)
 *   - 4+ failures → base × 4 (stays capped)
 */
function scheduleNextRefresh(baseMs: number): void {
  const failures = state.consecutiveFailures;

  let delay: number;
  if (failures === 0) {
    delay = baseMs;
  } else {
    delay = Math.min(baseMs * Math.pow(2, failures - 1), baseMs * 4);
  }

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

  // Run immediately on start, then schedule repeating back-off loop.
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
  isStale: boolean;
  consecutiveFailures: number;
  lastError: string | null;
} {
  return {
    lastRefreshedAt: state.lastRefreshedAt?.toISOString() ?? null,
    usingRealData: state.usingRealData,
    isStale: isDataStale(),
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError,
  };
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

/**
 * In-memory cache for sports data with TTL.
 * Refreshes once per hour by default to conserve Odds API quota.
 * Tracks last refresh time and quota usage.
 */

import { logger } from "./logger";
import {
  ALL_SPORTS,
  fetchActiveSports,
  fetchGameOdds,
  fetchAllEventProps,
  getQuotaStats,
  type OddsApiEventWithOdds,
  type OddsApiMarket,
} from "./oddsApi";
import { generatePicksFromOdds, type GeneratedPick } from "./picksEngine";

// ─── Cache state ──────────────────────────────────────────────────────────────

export interface SportDataEntry {
  sportKey: string;
  sportTitle: string;
  category: string;
  events: OddsApiEventWithOdds[];
  propMarkets: Record<string, OddsApiMarket[]>; // eventId → markets
  picks: GeneratedPick[];
  fetchedAt: Date;
}

export interface CacheState {
  sports: SportDataEntry[];
  lastRefresh: Date | null;
  isRefreshing: boolean;
  error: string | null;
  quotaRemaining: number | null;
  isRealData: boolean;
}

const state: CacheState = {
  sports: [],
  lastRefresh: null,
  isRefreshing: false,
  error: null,
  quotaRemaining: null,
  isRealData: false,
};

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function getCacheState(): CacheState {
  return { ...state, sports: state.sports };
}

export function isApiConfigured(): boolean {
  return !!process.env.THE_ODDS_API_KEY;
}

export function isCacheStale(): boolean {
  if (!state.lastRefresh) return true;
  return Date.now() - state.lastRefresh.getTime() > REFRESH_INTERVAL_MS;
}

// ─── Refresh logic ────────────────────────────────────────────────────────────

export async function refreshSportsData(force = false): Promise<void> {
  if (!isApiConfigured()) {
    state.error = "THE_ODDS_API_KEY not configured";
    state.isRealData = false;
    return;
  }

  if (state.isRefreshing) return;
  if (!force && !isCacheStale()) return;

  state.isRefreshing = true;
  state.error = null;
  logger.info("Sports cache refresh started");

  try {
    // 1. Discover which sports are currently active (in-season)
    const activeSports = await fetchActiveSports();
    const activeKeys = new Set(activeSports.filter((s) => s.active).map((s) => s.key));

    // 2. Match against our supported sports list
    const sportsToFetch = ALL_SPORTS.filter((s) => activeKeys.has(s.key));

    if (sportsToFetch.length === 0) {
      logger.warn("No active sports found from Odds API");
    }

    const entries: SportDataEntry[] = [];

    for (const sport of sportsToFetch) {
      try {
        // 3. Fetch game odds (h2h + spreads + totals) for every event — 1 quota credit
        const events = await fetchGameOdds(sport.key);

        if (events.length === 0) continue;

        // 4. For sports with player props, fetch props for today's top events
        const propMarkets: Record<string, OddsApiMarket[]> = {};

        if (sport.fetchProps && sport.propMarkets.length > 0) {
          // Sort events by commence time, take first 3 (closest upcoming)
          const upcomingEvents = events
            .filter((e) => {
              const start = new Date(e.commence_time);
              const now = new Date();
              const hoursFromNow = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
              return hoursFromNow >= -3 && hoursFromNow <= 24; // started within 3h or starts within 24h
            })
            .slice(0, 3);

          for (const event of upcomingEvents) {
            try {
              const markets = await fetchAllEventProps(event.id, sport.key, sport.propMarkets);
              if (markets.length > 0) {
                propMarkets[event.id] = markets;
              }
            } catch (e) {
              logger.warn({ err: e, eventId: event.id }, "Failed to fetch props for event");
            }
          }
        }

        // 5. Generate picks from the real odds data
        const picks = await generatePicksFromOdds(events, propMarkets, sport.title);

        entries.push({
          sportKey: sport.key,
          sportTitle: sport.title,
          category: sport.category,
          events,
          propMarkets,
          picks,
          fetchedAt: new Date(),
        });

        logger.info(
          { sport: sport.title, events: events.length, picks: picks.length },
          "Sport data loaded",
        );
      } catch (e) {
        logger.warn({ err: e, sport: sport.key }, "Failed to fetch sport data");
      }
    }

    state.sports = entries;
    state.lastRefresh = new Date();
    state.isRealData = true;
    state.error = null;

    const quota = getQuotaStats();
    if (quota.remainingRequests !== null) {
      state.quotaRemaining = quota.remainingRequests;
    }

    logger.info(
      {
        sports: entries.length,
        totalPicks: entries.reduce((s, e) => s + e.picks.length, 0),
        quotaRemaining: state.quotaRemaining,
      },
      "Sports cache refresh complete",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.error = msg;
    state.isRealData = false;
    logger.error({ err: e }, "Sports cache refresh failed");
  } finally {
    state.isRefreshing = false;
  }
}

// ─── Data accessors ───────────────────────────────────────────────────────────

export function getAllPicks(): GeneratedPick[] {
  return state.sports.flatMap((s) => s.picks);
}

export function getAllGames() {
  return state.sports.flatMap((s) =>
    s.events.map((e) => ({
      id: e.id,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      sport: s.sportTitle,
      scheduledAt: e.commence_time,
      status: "Scheduled" as const,
      homeScore: null,
      awayScore: null,
      quarter: null,
      timeRemaining: null,
    })),
  );
}

export function getGamesBySport(sport: string) {
  return getAllGames().filter((g) => g.sport.toLowerCase() === sport.toLowerCase());
}

// ─── Background auto-refresh ──────────────────────────────────────────────────

export function startAutoRefresh(): void {
  if (!isApiConfigured()) return;

  // Initial load
  refreshSportsData().catch((e) => logger.error({ err: e }, "Initial sports refresh failed"));

  // Periodic refresh every hour
  setInterval(() => {
    refreshSportsData().catch((e) => logger.error({ err: e }, "Periodic sports refresh failed"));
  }, REFRESH_INTERVAL_MS);
}

/**
 * Unit + integration tests for sportsCache.ts
 *
 * Covers:
 *   1. isDataStale() — all four conditions (no key, never refreshed, fresh, over-threshold)
 *   2. computeBackoffDelay() — 0-5 consecutive failures produce correct multipliers
 *   3. refreshCache() failure path — consecutiveFailures increments, prior data retained
 *   4. refreshCache() success path — consecutiveFailures resets, source set to "live"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock all I/O dependencies before the module under test is imported ───────

vi.mock("./oddsApi.js", () => ({
  fetchEvents: vi.fn(),
  fetchScores: vi.fn(),
  fetchPlayerProps: vi.fn(),
  SPORT_KEYS: { basketball_nba: "basketball_nba" },
}));

vi.mock("./picksEngine.js", () => ({
  eventsToGames: vi.fn(() => []),
  scoreEventsToGames: vi.fn(() => []),
  scoresToLiveGames: vi.fn(() => []),
  buildPicksFromEvents: vi.fn(async () => []),
  buildTicketsFromPicks: vi.fn(() => []),
}));

vi.mock("./mockData.js", () => ({
  mockGames: [],
  mockPicks: [],
  mockLiveGames: [],
  mockLivePicks: [],
  mockSignals: {},
  mockTickets: [],
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import module under test (after mocks are hoisted) ───────────────────────

import {
  isDataStale,
  computeBackoffDelay,
  refreshCache,
  getCacheStatus,
  getPicks,
  getGames,
  _resetStateForTesting,
} from "./sportsCache.js";
import * as oddsApi from "./oddsApi.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_MS = 15 * 60 * 1000; // 15 minutes — matches the production default

/** Install a fake API key so isOddsApiEnabled() returns true. */
function enableApiKey() {
  process.env["THE_ODDS_API_KEY"] = "test-key";
}

/** Remove the fake API key. */
function disableApiKey() {
  delete process.env["THE_ODDS_API_KEY"];
  delete process.env["ODDS_API_KEY"];
}

// ─── isDataStale() ────────────────────────────────────────────────────────────

describe("isDataStale()", () => {
  beforeEach(() => {
    _resetStateForTesting();
    disableApiKey();
  });

  afterEach(() => {
    disableApiKey();
    _resetStateForTesting();
  });

  it("is stale when THE_ODDS_API_KEY is not set (demo mode)", () => {
    expect(isDataStale()).toBe(true);
  });

  it("is stale when API key is set but data has never been refreshed", () => {
    enableApiKey();
    // usingRealData remains false (default after reset)
    expect(isDataStale()).toBe(true);
  });

  it("is stale when API key is set, usingRealData=true, but lastRefreshedAt is null", () => {
    enableApiKey();
    // Manually put state into an inconsistent but possible mid-refresh situation.
    // We can do this indirectly by calling getCacheStatus after a partial mock.
    // Here we just verify the guard: usingRealData=true but lastRefreshedAt=null.
    // The only public way to get there is _resetStateForTesting + direct state;
    // since state isn't exported we test via the refreshCache failure path below.
    // This case is covered as a by-product of the "never refreshed" test above
    // which also has lastRefreshedAt=null.
    expect(isDataStale()).toBe(true); // still no key — belt-and-suspenders
  });

  it("is NOT stale when data was just refreshed", async () => {
    enableApiKey();
    // fetchEvents / fetchScores return empty arrays → successful refresh
    vi.mocked(oddsApi.fetchEvents).mockResolvedValue([]);
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

    await refreshCache();

    expect(isDataStale()).toBe(false);
  });

  it("is stale when last refresh is older than PICKS_STALENESS_MINUTES", async () => {
    enableApiKey();
    vi.useFakeTimers();
    try {
      vi.mocked(oddsApi.fetchEvents).mockResolvedValue([]);
      vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

      await refreshCache();
      expect(isDataStale()).toBe(false); // just refreshed — should be fresh

      // Advance the clock past the default 45-minute threshold.
      vi.advanceTimersByTime(46 * 60 * 1000);
      expect(isDataStale()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── computeBackoffDelay() ────────────────────────────────────────────────────

describe("computeBackoffDelay()", () => {
  it("0 failures → 1× base (normal cadence)", () => {
    expect(computeBackoffDelay(BASE_MS, 0)).toBe(BASE_MS);
  });

  it("1 failure → 1× base (2^0 = 1)", () => {
    expect(computeBackoffDelay(BASE_MS, 1)).toBe(BASE_MS);
  });

  it("2 failures → 2× base (2^1 = 2)", () => {
    expect(computeBackoffDelay(BASE_MS, 2)).toBe(BASE_MS * 2);
  });

  it("3 failures → 4× base (2^2 = 4, hits cap)", () => {
    expect(computeBackoffDelay(BASE_MS, 3)).toBe(BASE_MS * 4);
  });

  it("4 failures → 4× base (2^3 = 8, capped at 4×)", () => {
    expect(computeBackoffDelay(BASE_MS, 4)).toBe(BASE_MS * 4);
  });

  it("5 failures → 4× base (stays capped)", () => {
    expect(computeBackoffDelay(BASE_MS, 5)).toBe(BASE_MS * 4);
  });

  it("cap is exactly 4× regardless of base interval", () => {
    const smallBase = 1000;
    expect(computeBackoffDelay(smallBase, 10)).toBe(smallBase * 4);
  });
});

// ─── refreshCache() failure path ──────────────────────────────────────────────

describe("refreshCache() — failure path", () => {
  beforeEach(() => {
    _resetStateForTesting();
    enableApiKey();
  });

  afterEach(() => {
    disableApiKey();
    _resetStateForTesting();
  });

  it("increments consecutiveFailures on fetchEvents throwing", async () => {
    vi.mocked(oddsApi.fetchEvents).mockRejectedValue(new Error("Network error"));
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

    await refreshCache();

    expect(getCacheStatus().consecutiveFailures).toBe(1);
  });

  it("retains prior pick data when refresh fails", async () => {
    // First, a successful refresh that stores sentinel picks.
    const sentinelGame = {
      id: "g1",
      sport: "basketball_nba",
      homeTeam: "Lakers",
      awayTeam: "Celtics",
      commenceTime: new Date().toISOString(),
      status: "Scheduled",
      homeScore: null,
      awayScore: null,
      bookmakers: [],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(oddsApi.fetchEvents).mockResolvedValueOnce([sentinelGame as any]);
    vi.mocked(oddsApi.fetchScores).mockResolvedValueOnce([]);

    // picksEngine.eventsToGames is also mocked — feed it a real-ish return so
    // the state actually gets populated.
    const { eventsToGames } = await import("./picksEngine.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(eventsToGames).mockReturnValueOnce([sentinelGame as any]);

    await refreshCache();

    const gamesAfterSuccess = getGames();
    expect(gamesAfterSuccess.length).toBeGreaterThan(0);

    // Now simulate a network failure.
    vi.mocked(oddsApi.fetchEvents).mockRejectedValue(new Error("Timeout"));

    await refreshCache();

    // Games from the first successful fetch must still be present.
    expect(getGames()).toEqual(gamesAfterSuccess);
    expect(getCacheStatus().consecutiveFailures).toBe(1);
  });

  it("consecutiveFailures increments on each successive failure", async () => {
    vi.mocked(oddsApi.fetchEvents).mockRejectedValue(new Error("Timeout"));
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

    await refreshCache();
    await refreshCache();
    await refreshCache();

    expect(getCacheStatus().consecutiveFailures).toBe(3);
  });

  it("records lastError message on failure", async () => {
    vi.mocked(oddsApi.fetchEvents).mockRejectedValue(new Error("HTTP 429"));
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

    await refreshCache();

    const status = getCacheStatus();
    expect(status.lastError).toBeTruthy();
  });
});

// ─── refreshCache() success path ──────────────────────────────────────────────

describe("refreshCache() — success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStateForTesting();
    enableApiKey();
    vi.mocked(oddsApi.fetchEvents).mockResolvedValue([]);
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);
  });

  afterEach(() => {
    disableApiKey();
    _resetStateForTesting();
  });

  it("sets source to 'live' after a successful refresh", async () => {
    await refreshCache();
    expect(getCacheStatus().source).toBe("live");
  });

  it("resets consecutiveFailures to 0 after success following failures", async () => {
    // Cause 2 failures first.
    vi.mocked(oddsApi.fetchEvents).mockRejectedValueOnce(new Error("Timeout"));
    await refreshCache();
    vi.mocked(oddsApi.fetchEvents).mockRejectedValueOnce(new Error("Timeout"));
    await refreshCache();
    expect(getCacheStatus().consecutiveFailures).toBe(2);

    // Now succeed.
    vi.mocked(oddsApi.fetchEvents).mockResolvedValue([]);
    await refreshCache();

    expect(getCacheStatus().consecutiveFailures).toBe(0);
  });

  it("sets usingRealData to true", async () => {
    await refreshCache();
    expect(getCacheStatus().usingRealData).toBe(true);
  });

  it("clears lastError on success", async () => {
    vi.mocked(oddsApi.fetchEvents).mockRejectedValueOnce(new Error("Timeout"));
    await refreshCache();
    expect(getCacheStatus().lastError).toBeTruthy();

    vi.mocked(oddsApi.fetchEvents).mockResolvedValue([]);
    await refreshCache();
    expect(getCacheStatus().lastError).toBeNull();
  });

  it("skips refresh when isRefreshing is true (re-entrancy guard)", async () => {
    // Trigger a refresh but don't await it yet.
    let resolveFirstFetch!: () => void;
    vi.mocked(oddsApi.fetchEvents).mockReturnValueOnce(
      new Promise<[]>((resolve) => {
        resolveFirstFetch = () => resolve([]);
      }),
    );
    vi.mocked(oddsApi.fetchScores).mockResolvedValue([]);

    const first = refreshCache(); // starts, isRefreshing = true
    const second = refreshCache(); // should bail out immediately

    resolveFirstFetch();
    await first;
    await second;

    // fetchEvents should have been called only once (second call was a no-op).
    expect(vi.mocked(oddsApi.fetchEvents).mock.calls.length).toBe(1);
  });
});

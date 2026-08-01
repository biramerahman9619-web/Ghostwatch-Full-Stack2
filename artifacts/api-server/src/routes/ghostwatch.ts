import { Router, type IRouter } from "express";
import {
  ListPicksQueryParams,
  ListPicksResponse,
  GetPicksSummaryResponse,
  ListGamesQueryParams,
  ListGamesResponse,
  GetTopPicksResponse,
} from "@workspace/api-zod";
import { mockPicks, mockGames } from "../lib/mockData";
import {
  getAllPicks,
  getAllGames,
  isApiConfigured,
  getCacheState,
  refreshSportsData,
} from "../lib/sportsCache";
import type { GeneratedPick } from "../lib/picksEngine";

const router: IRouter = Router();

/** Merge real + mock picks, preferring real data when available. */
function getActivePicks() {
  if (isApiConfigured()) {
    const real = getAllPicks();
    if (real.length > 0) return real;
  }
  // Fall back to mock data when API not configured or no data yet
  return mockPicks as unknown as GeneratedPick[];
}

function getActiveGames() {
  if (isApiConfigured()) {
    const real = getAllGames();
    if (real.length > 0) return real;
  }
  return mockGames;
}

router.get("/ghostwatch/picks", async (req, res): Promise<void> => {
  const query = ListPicksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let picks = getActivePicks();

  if (query.data.sport) {
    picks = picks.filter((p) => p.sport.toLowerCase() === query.data.sport!.toLowerCase());
  }
  if (query.data.riskTier) {
    picks = picks.filter((p) => p.riskTier === query.data.riskTier);
  }
  if (query.data.minConfidence !== undefined) {
    picks = picks.filter((p) => p.confidence >= Number(query.data.minConfidence));
  }

  res.json(ListPicksResponse.parse(picks));
});

router.get("/ghostwatch/picks/summary", async (_req, res): Promise<void> => {
  const picks = getActivePicks();
  const cache = getCacheState();

  const byRiskTier = {
    Safe: picks.filter((p) => p.riskTier === "Safe").length,
    Balanced: picks.filter((p) => p.riskTier === "Balanced").length,
    Aggressive: picks.filter((p) => p.riskTier === "Aggressive").length,
  };
  const sportCounts = picks.reduce<Record<string, number>>((acc, p) => {
    acc[p.sport] = (acc[p.sport] ?? 0) + 1;
    return acc;
  }, {});
  const bySport = Object.entries(sportCounts).map(([sport, count]) => ({ sport, count }));
  const avgConfidence =
    picks.length > 0
      ? picks.reduce((sum, p) => sum + p.confidence, 0) / picks.length
      : 0;
  const topSport = [...bySport].sort((a, b) => b.count - a.count)[0]?.sport ?? "NBA";

  res.json(
    GetPicksSummaryResponse.parse({
      totalPicks: picks.length,
      byRiskTier,
      bySport,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      topSport,
      // Metadata fields (not in Zod schema but ignored by parse)
      _meta: {
        isRealData: cache.isRealData,
        lastRefresh: cache.lastRefresh?.toISOString() ?? null,
        quotaRemaining: cache.quotaRemaining,
        error: cache.error,
      },
    }),
  );
});

router.get("/ghostwatch/games", async (req, res): Promise<void> => {
  const query = ListGamesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let games = getActiveGames();
  if (query.data.sport) {
    games = games.filter(
      (g) => g.sport.toLowerCase() === query.data.sport!.toLowerCase(),
    );
  }

  res.json(ListGamesResponse.parse(games));
});

router.get("/ghostwatch/top-picks", async (_req, res): Promise<void> => {
  const top = [...getActivePicks()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  res.json(GetTopPicksResponse.parse(top));
});

// Manual refresh endpoint
router.post("/ghostwatch/refresh", async (_req, res): Promise<void> => {
  if (!isApiConfigured()) {
    res.status(400).json({ error: "THE_ODDS_API_KEY not configured" });
    return;
  }
  // Kick off async refresh, respond immediately
  refreshSportsData(true).catch(() => {});
  res.json({ status: "refresh started" });
});

// Data status endpoint
router.get("/ghostwatch/status", async (_req, res): Promise<void> => {
  const cache = getCacheState();
  res.json({
    isRealData: cache.isRealData,
    isApiConfigured: isApiConfigured(),
    lastRefresh: cache.lastRefresh?.toISOString() ?? null,
    isRefreshing: cache.isRefreshing,
    error: cache.error,
    quotaRemaining: cache.quotaRemaining,
    sportCount: cache.sports.length,
    totalPicks: cache.sports.reduce((s, e) => s + e.picks.length, 0),
  });
});

export default router;

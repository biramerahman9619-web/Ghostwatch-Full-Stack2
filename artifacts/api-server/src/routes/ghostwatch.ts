import { Router, type IRouter } from "express";
import {
  ListPicksQueryParams,
  ListPicksResponse,
  GetPicksSummaryResponse,
  ListGamesQueryParams,
  ListGamesResponse,
  GetTopPicksResponse,
} from "@workspace/api-zod";
import { getGames, getPicks, getCacheStatus, isApiConfigured, refreshSportsData } from "../lib/sportsCache.js";

const router: IRouter = Router();

router.get("/ghostwatch/picks", async (req, res): Promise<void> => {
  const query = ListPicksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let picks = [...getPicks()];

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
  const picks = getPicks();

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
  const avgConfidence = picks.length
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
    }),
  );
});

router.get("/ghostwatch/games", async (req, res): Promise<void> => {
  const query = ListGamesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let games = [...getGames()];
  if (query.data.sport) {
    games = games.filter(
      (g) => g.sport.toLowerCase() === query.data.sport!.toLowerCase(),
    );
  }

  res.json(ListGamesResponse.parse(games));
});

router.get("/ghostwatch/top-picks", async (_req, res): Promise<void> => {
  const top = [...getPicks()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  res.json(GetTopPicksResponse.parse(top));
});

// Manual one-off refresh (useful for development/admin)
router.post("/ghostwatch/refresh", async (_req, res): Promise<void> => {
  if (!isApiConfigured()) {
    res.status(400).json({ error: "THE_ODDS_API_KEY not configured" });
    return;
  }
  refreshSportsData(true).catch(() => {});
  res.json({ status: "refresh started" });
});

router.get("/ghostwatch/status", async (_req, res): Promise<void> => {
  res.json(getCacheStatus());
});

export default router;

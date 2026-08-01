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

const router: IRouter = Router();

router.get("/ghostwatch/picks", async (req, res): Promise<void> => {
  const query = ListPicksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let picks = [...mockPicks];

  if (query.data.sport) {
    picks = picks.filter((p) => p.sport === query.data.sport);
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
  const picks = mockPicks;
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
  const avgConfidence = picks.reduce((sum, p) => sum + p.confidence, 0) / picks.length;
  const topSport = bySport.sort((a, b) => b.count - a.count)[0]?.sport ?? "NBA";

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

  let games = [...mockGames];
  if (query.data.sport) {
    games = games.filter((g) => g.sport === query.data.sport);
  }

  res.json(ListGamesResponse.parse(games));
});

router.get("/ghostwatch/top-picks", async (_req, res): Promise<void> => {
  const top = [...mockPicks]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  res.json(GetTopPicksResponse.parse(top));
});

export default router;

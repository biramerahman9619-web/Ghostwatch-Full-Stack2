import { Router, type IRouter } from "express";
import {
  ListLivePicksQueryParams,
  ListLivePicksResponse,
  ListLiveGamesResponse,
  ListSignalsQueryParams,
  ListSignalsResponse,
} from "@workspace/api-zod";
import { mockLivePicks, mockLiveGames, mockSignals } from "../lib/mockData";
import { isApiConfigured, getCacheState, getAllGames } from "../lib/sportsCache";

const router: IRouter = Router();

router.get("/ghost-express/live-games", async (_req, res): Promise<void> => {
  if (isApiConfigured()) {
    const allGames = getAllGames();
    // Games that started in the last 4 hours and haven't ended — treat as "live"
    const now = Date.now();
    const live = allGames.filter((g) => {
      const start = new Date(g.scheduledAt).getTime();
      const ageHours = (now - start) / (1000 * 60 * 60);
      return ageHours >= 0 && ageHours <= 4;
    });

    if (live.length > 0) {
      const liveWithStatus = live.map((g) => ({
        ...g,
        status: "Live" as const,
        pace: "Normal" as const,
      }));
      res.json(ListLiveGamesResponse.parse(liveWithStatus));
      return;
    }
  }
  res.json(ListLiveGamesResponse.parse(mockLiveGames));
});

router.get("/ghost-express/live-picks", async (req, res): Promise<void> => {
  const query = ListLivePicksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // Live picks are generated from real-time props — use mock as fallback
  // (true live updates would require a streaming odds feed subscription)
  let picks = [...mockLivePicks];
  if (query.data.gameId) {
    picks = picks.filter((p) => p.gameId === query.data.gameId);
  }

  res.json(ListLivePicksResponse.parse(picks));
});

router.get("/ghost-express/signals", async (req, res): Promise<void> => {
  const query = ListSignalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const signals = mockSignals[query.data.gameId] ?? [];
  res.json(ListSignalsResponse.parse(signals));
});

export default router;

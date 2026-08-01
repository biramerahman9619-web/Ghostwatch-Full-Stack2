import { Router, type IRouter } from "express";
import {
  ListLivePicksQueryParams,
  ListLivePicksResponse,
  ListLiveGamesResponse,
  ListSignalsQueryParams,
  ListSignalsResponse,
} from "@workspace/api-zod";
import { mockLivePicks, mockLiveGames, mockSignals } from "../lib/mockData";

const router: IRouter = Router();

router.get("/ghost-express/live-games", async (_req, res): Promise<void> => {
  res.json(ListLiveGamesResponse.parse(mockLiveGames));
});

router.get("/ghost-express/live-picks", async (req, res): Promise<void> => {
  const query = ListLivePicksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

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

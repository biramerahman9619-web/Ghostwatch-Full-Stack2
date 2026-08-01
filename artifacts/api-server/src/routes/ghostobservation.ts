import { Router, type IRouter } from "express";
import {
  ListAlertsQueryParams,
  ListAlertsResponse,
  ListPlayerSocialScoresResponse,
  ListTeamPulseResponse,
} from "@workspace/api-zod";
import { mockAlerts, mockPlayerSocialScores, mockTeamPulse } from "../lib/mockData";

const router: IRouter = Router();

router.get("/ghostobservation/alerts", async (req, res): Promise<void> => {
  const query = ListAlertsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let alerts = [...mockAlerts];
  if (query.data.playerId) {
    alerts = alerts.filter((a) => a.playerId === query.data.playerId);
  }
  if (query.data.teamId) {
    alerts = alerts.filter((a) => {
      const teamPulse = mockTeamPulse.find((t) => t.teamId === query.data.teamId);
      return teamPulse ? a.team === teamPulse.teamName : true;
    });
  }

  res.json(ListAlertsResponse.parse(alerts));
});

router.get("/ghostobservation/player-scores", async (_req, res): Promise<void> => {
  res.json(ListPlayerSocialScoresResponse.parse(mockPlayerSocialScores));
});

router.get("/ghostobservation/team-pulse", async (_req, res): Promise<void> => {
  res.json(ListTeamPulseResponse.parse(mockTeamPulse));
});

export default router;

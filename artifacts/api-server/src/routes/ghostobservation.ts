import { Router, type IRouter } from "express";
import {
  ListAlertsQueryParams,
  ListAlertsResponse,
  ListPlayerSocialScoresResponse,
  ListTeamPulseResponse,
} from "@workspace/api-zod";
import { mockAlerts, mockPlayerSocialScores, mockTeamPulse } from "../lib/mockData";
import {
  getAlerts,
  getPlayerScores,
  getTeamPulse,
  getObservationStatus,
} from "../lib/observationCache";

const router: IRouter = Router();

/**
 * Return real alerts when the observation cache is populated, otherwise mock.
 * Filter by playerId or teamId when provided.
 */
router.get("/ghostobservation/alerts", async (req, res): Promise<void> => {
  const query = ListAlertsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const realAlerts = getAlerts();
  const source = realAlerts.length > 0 ? realAlerts : mockAlerts;

  let alerts = [...source];

  if (query.data.playerId) {
    alerts = alerts.filter((a) => a.playerId === query.data.playerId);
  }
  if (query.data.teamId) {
    // For real alerts, match by team name substring since teamId format differs
    const realTeamPulse = getTeamPulse();
    const teamEntry =
      realTeamPulse.find((t) => t.teamId === query.data.teamId) ??
      mockTeamPulse.find((t) => t.teamId === query.data.teamId);
    if (teamEntry) {
      alerts = alerts.filter((a) => a.team === teamEntry.teamName);
    }
  }

  res.json(ListAlertsResponse.parse(alerts));
});

/** Player social impact scores — real from AI intel, mock fallback. */
router.get("/ghostobservation/player-scores", async (_req, res): Promise<void> => {
  const real = getPlayerScores();
  res.json(ListPlayerSocialScoresResponse.parse(real.length > 0 ? real : mockPlayerSocialScores));
});

/** Team chemistry/drama/fatigue pulse — real from AI intel, mock fallback. */
router.get("/ghostobservation/team-pulse", async (_req, res): Promise<void> => {
  const real = getTeamPulse();
  res.json(ListTeamPulseResponse.parse(real.length > 0 ? real : mockTeamPulse));
});

/** Observation data provenance — useful for the data-freshness indicator (Task #4). */
router.get("/ghostobservation/status", async (_req, res): Promise<void> => {
  res.json(getObservationStatus());
});

export default router;

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getCacheStatus, isOddsApiEnabled } from "../lib/sportsCache.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const cache = getCacheStatus();

  // Classify data freshness for external monitors.
  let dataFreshness: "ok" | "stale" | "no_api_key";
  if (!isOddsApiEnabled()) {
    dataFreshness = "no_api_key";
  } else if (cache.isStale) {
    dataFreshness = "stale";
  } else {
    dataFreshness = "ok";
  }

  // "ok" = live data fresh; "degraded" = serving stale or demo data.
  const status = dataFreshness === "ok" ? "ok" : "degraded";

  const data = HealthCheckResponse.parse({
    status,
    dataFreshness,
    isStale: cache.isStale,
    lastRefreshedAt: cache.lastRefreshedAt,
    consecutiveFailures: cache.consecutiveFailures,
  });

  // Return 503 when degraded so external HTTP monitors (Datadog, Uptime Robot,
  // Kubernetes readiness probes, etc.) automatically alert on stale data without
  // needing to parse the response body.
  const httpStatus = status === "ok" ? 200 : 503;
  res.status(httpStatus).json(data);
});

export default router;

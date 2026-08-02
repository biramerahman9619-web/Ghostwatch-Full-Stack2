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

  // "ok" = live data fresh; "degraded" = serving stale, snapshot, or demo data.
  const status = dataFreshness === "ok" ? "ok" : "degraded";

  const data = HealthCheckResponse.parse({
    status,
    dataFreshness,
    isStale: cache.isStale,
    lastRefreshedAt: cache.lastRefreshedAt,
    consecutiveFailures: cache.consecutiveFailures,
    source: cache.source,
  });

  // Always return 200 — the server is up and serving requests.
  // The body's `status` field ("ok" vs "degraded") lets external monitors
  // (Datadog, Uptime Robot, etc.) inspect data freshness without the HTTP
  // status causing the Autoscale startup probe to fail on every cold start.
  res.status(200).json(data);
});

export default router;

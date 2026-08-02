import app from "./app";
import { logger } from "./lib/logger";
import { startAutoRefresh } from "./lib/sportsCache";
import { startObservationRefresh } from "./lib/observationCache";
import { startAgentLoop } from "./lib/ghostspereAgent";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Kick off real-time sports data pipeline (no-ops if API key not set)
  startAutoRefresh();

  // Start observation refresh shortly after server starts (ESPN data; no sports-cache dependency)
  startObservationRefresh(5_000);

  // Start the Ghostspere autonomous agent loop (60-second tick)
  startAgentLoop();
});

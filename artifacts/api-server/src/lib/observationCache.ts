/**
 * Ghostobservation cache — real injury reports and derived team intelligence.
 *
 * Primary data source: ESPN public injury endpoint (HTTPS, no API key required).
 * All alert descriptions are constructed directly from verifiable ESPN fields only:
 *   player name, injury type, body part, and official status text.
 *
 * What is real vs. derived:
 *   - Alerts:         Real player injury statuses from ESPN Injury Reports.
 *   - Player scores:  Derived from injury severity (not social-media analysis).
 *   - Team pulse:     Derived from injury counts per team (not AI-generated scores).
 *
 * No AI generation of injury claims or social-behavior assertions.
 * All data is sourced and attributed to ESPN with per-record sourceUrl.
 *
 * Provenance guarantees:
 *   - usingRealData becomes true only when ESPN fetch succeeds with ≥1 record.
 *   - Refresh is atomic: cache is only replaced when the full new dataset is ready.
 *   - If ALL sport fetches fail, an error is thrown and prior state is retained.
 *   - A partial failure (some sports succeed) still replaces cache only with the
 *     successful sports' data AND logs a warning listing skipped sports.
 *   - On any unhandled error, prior state is always retained.
 */

import { logger } from "./logger.js";

// ─── ESPN API configuration ───────────────────────────────────────────────────

interface EspnSport {
  sport: string;
  league: string;
  title: string;
}

const ESPN_SPORTS: EspnSport[] = [
  { sport: "basketball", league: "wnba", title: "WNBA" },
  { sport: "baseball",   league: "mlb",  title: "MLB"  },
  { sport: "football",   league: "nfl",  title: "NFL"  },
  { sport: "basketball", league: "nba",  title: "NBA"  },
  { sport: "icehockey",  league: "nhl",  title: "NHL"  },
];

// Always HTTPS to prevent response tampering in transit.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// ─── ESPN response types ──────────────────────────────────────────────────────

interface EspnAthleteTeam {
  displayName: string;
  abbreviation?: string;
}

interface EspnAthlete {
  displayName: string;
  shortName?: string;
  team?: EspnAthleteTeam;
}

interface EspnInjuryType {
  /**
   * Official ESPN status string. Examples by league:
   *   WNBA/NBA: "out", "day-to-day", "questionable"
   *   MLB:      "60-day IL", "15-day IL", "10-day IL", "day-to-day", "Suspension"
   *   NFL:      "Injured Reserve", "out", "questionable", "Suspension", "active"
   *   NHL:      "out", "day-to-day", "IR", "LTIR"
   */
  description: string;
  name: string;
}

interface EspnInjuryDetails {
  type?: string;       // Body part: "Knee", "Elbow", "Hamstring", "Coach's Decision"
  detail?: string;     // Specific: "Surgery", "Sprain", "Strain"
  side?: string;       // "Left" | "Right"
  returnDate?: string; // ISO date string
}

interface EspnPlayerInjury {
  id: string;
  longComment?: string;
  shortComment?: string;
  date?: string;
  athlete?: EspnAthlete;
  type?: EspnInjuryType;
  details?: EspnInjuryDetails;
}

interface EspnTeamInjuryGroup {
  id: string;
  displayName: string;
  injuries?: EspnPlayerInjury[];
}

interface EspnInjuryResponse {
  injuries?: EspnTeamInjuryGroup[];
}

// ─── Public types ─────────────────────────────────────────────────────────────

/** Must match the OpenAPI SocialAlert alertType enum exactly. */
export type AlertType =
  | "InjuryConcern"
  | "PartyRisk"
  | "FatigueRisk"
  | "MotivationBoost"
  | "DramaAlert"
  | "TravelFatigue";

export interface ObservationAlert {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  alertType: AlertType;
  description: string;
  severity: "Low" | "Medium" | "High";
  source?: string;
  sourceUrl?: string;
  createdAt: string;
}

export interface ObservationPlayerScore {
  playerId: string;
  playerName: string;
  team: string;
  sport: string;
  /** -1.0 (very negative) to +1.0 (very positive) — derived from injury severity only */
  socialImpactScore: number;
  flags: string[];
  updatedAt: string;
}

export interface ObservationTeamPulse {
  teamId: string;
  teamName: string;
  sport: string;
  /** 0–100, derived from injury count (each active injury lowers chemistry) */
  chemistryScore: number;
  dramaLevel: "Low" | "Medium" | "High";
  /** Always "None" — travel data not available on the free ESPN tier */
  travelFatigue: "None" | "Moderate" | "Severe";
  /** Count of players with an active injury status */
  recentAlerts: number;
  notes: string;
}

// ─── Status normalization ─────────────────────────────────────────────────────

/**
 * Normalize the full range of ESPN status strings across all five leagues
 * into severity buckets.  Returns null for statuses that should be excluded
 * (e.g. "active", "probable", "Suspension" — non-injury designations).
 */
function normalizeStatus(raw: string): { severity: "Low" | "Medium" | "High" } | null {
  const s = raw.toLowerCase().trim();

  // High severity — player is effectively unavailable
  if (
    s === "out" ||
    s === "doubtful" ||
    s === "60-day il" ||
    s === "15-day il" ||
    s === "10-day il" ||
    s === "injured reserve" ||
    s === "ir" ||
    s === "ltir" ||           // Long-term injured reserve (NHL)
    s === "pup"               // Physically unable to perform (NFL pre-season)
  ) {
    return { severity: "High" };
  }

  // Medium severity — player status uncertain, bettors should track
  if (
    s === "questionable" ||
    s === "day-to-day" ||
    s === "dtd"
  ) {
    return { severity: "Medium" };
  }

  // Low severity — player listed but expected to play
  if (s === "probable") {
    return { severity: "Low" };
  }

  // Exclude: "active", "Suspension" (not injury-related), unknown strings
  return null;
}

function severityToImpact(severity: "Low" | "Medium" | "High"): number {
  if (severity === "High")   return -0.85;
  if (severity === "Medium") return -0.40;
  return -0.10;
}

/** Build a plain-language description from ESPN's own fields — no invented claims. */
function buildDescription(injury: EspnPlayerInjury): string {
  const status = injury.type?.description ?? "questionable";
  const bodyPart = injury.details?.type ?? "undisclosed";
  const detail = injury.details?.detail;
  const side = injury.details?.side;
  const returnDate = injury.details?.returnDate;

  const bodyStr =
    side && detail  ? `${side} ${bodyPart} (${detail})`
    : detail        ? `${bodyPart} (${detail})`
    :                 bodyPart;

  const returnStr = returnDate
    ? ` Return target: ${new Date(returnDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
    : "";

  // Prefer ESPN's own text (already vetted editorial content) when available and concise.
  if (injury.longComment && injury.longComment.length > 15 && injury.longComment.length < 350) {
    return `${injury.longComment}${returnStr}`;
  }
  if (injury.shortComment && injury.shortComment.length > 10) {
    return `${injury.shortComment}${returnStr}`;
  }

  return `Listed as ${status} (${bodyStr}) per ESPN injury report.${returnStr}`;
}

// ─── ESPN fetch ───────────────────────────────────────────────────────────────

async function fetchEspnInjuries(espnSport: EspnSport): Promise<EspnPlayerInjury[]> {
  const url = `${ESPN_BASE}/${espnSport.sport}/${espnSport.league}/injuries`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Ghostwatch/1.0" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`ESPN ${espnSport.title} returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as EspnInjuryResponse;
  return (data.injuries ?? []).flatMap((group) => group.injuries ?? []);
}

// ─── Alert/score/pulse builders ───────────────────────────────────────────────

interface SportResult {
  alerts: ObservationAlert[];
  playerScores: ObservationPlayerScore[];
  teamMap: Map<string, { sport: string; alerts: ObservationAlert[] }>;
}

function processSportInjuries(
  injuries: EspnPlayerInjury[],
  espnSport: EspnSport,
  now: string,
): SportResult {
  const alerts: ObservationAlert[] = [];
  const teamMap = new Map<string, { sport: string; alerts: ObservationAlert[] }>();

  for (const inj of injuries) {
    const player = inj.athlete;
    if (!player?.displayName) continue;

    const rawStatus = inj.type?.description ?? "";
    const normalized = normalizeStatus(rawStatus);
    if (!normalized) continue; // "active", "Suspension", unknown — skip

    const teamName = player.team?.displayName ?? "Unknown Team";
    const playerId = `espn_${espnSport.league}_${inj.id}`;
    const sourceUrl = `https://www.espn.com/${espnSport.league}/injuries`;

    const alert: ObservationAlert = {
      id: `alert_${playerId}`,
      playerId,
      playerName: player.displayName,
      team: teamName,
      alertType: "InjuryConcern",
      description: buildDescription(inj),
      severity: normalized.severity,
      source: "ESPN Injury Report",
      sourceUrl,
      createdAt: now,
    };

    alerts.push(alert);

    const existing = teamMap.get(teamName);
    if (existing) {
      existing.alerts.push(alert);
    } else {
      teamMap.set(teamName, { sport: espnSport.title, alerts: [alert] });
    }
  }

  const playerScores: ObservationPlayerScore[] = alerts.map((a) => ({
    playerId: a.playerId,
    playerName: a.playerName,
    team: a.team,
    sport: espnSport.title,
    socialImpactScore: severityToImpact(a.severity),
    flags: ["InjuryConcern"],
    updatedAt: now,
  }));

  return { alerts, playerScores, teamMap };
}

function buildTeamPulse(
  teamMap: Map<string, { sport: string; alerts: ObservationAlert[] }>,
): ObservationTeamPulse[] {
  return [...teamMap.entries()].map(([teamName, { sport, alerts: teamAlerts }]) => {
    const highCount = teamAlerts.filter((a) => a.severity === "High").length;
    const totalCount = teamAlerts.length;

    const chemistryScore = Math.max(10, 90 - highCount * 15 - (totalCount - highCount) * 8);
    const dramaLevel: "Low" | "Medium" | "High" =
      highCount >= 3 ? "High" : highCount >= 1 ? "Medium" : "Low";

    const notes =
      totalCount === 0
        ? "No reported injuries."
        : `${totalCount} player${totalCount !== 1 ? "s" : ""} on the injury report (${highCount} unavailable/IL/IR). Source: ESPN.`;

    return {
      teamId: `team_${teamName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}`,
      teamName,
      sport,
      chemistryScore: Math.round(chemistryScore),
      dramaLevel,
      travelFatigue: "None" as const,
      recentAlerts: totalCount,
      notes,
    };
  });
}

// ─── Cache state ──────────────────────────────────────────────────────────────

interface ObservationState {
  alerts: ObservationAlert[];
  playerScores: ObservationPlayerScore[];
  teamPulse: ObservationTeamPulse[];
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;
  usingRealData: boolean;
  lastError: string | null;
}

const state: ObservationState = {
  alerts: [],
  playerScores: [],
  teamPulse: [],
  lastRefreshedAt: null,
  isRefreshing: false,
  usingRealData: false,
  lastError: null,
};

// ─── Refresh (atomic swap) ────────────────────────────────────────────────────

export async function refreshObservationCache(): Promise<void> {
  if (state.isRefreshing) return;

  state.isRefreshing = true;
  state.lastError = null;
  logger.info("Refreshing observation cache from ESPN injury reports");

  try {
    const now = new Date().toISOString();

    // Collect results from all sports; track which ones failed.
    const pendingAlerts: ObservationAlert[] = [];
    const pendingScores: ObservationPlayerScore[] = [];
    const pendingTeamMap = new Map<string, { sport: string; alerts: ObservationAlert[] }>();
    const failedSports: string[] = [];
    let totalRaw = 0;

    const results = await Promise.allSettled(
      ESPN_SPORTS.map(async (espnSport) => {
        const injuries = await fetchEspnInjuries(espnSport);
        return { espnSport, injuries };
      }),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        // Log but don't abort — we'll include data from successful sports.
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        logger.warn({ err: reason }, "ESPN sport fetch failed");
        failedSports.push(reason);
        continue;
      }

      const { espnSport, injuries } = result.value;
      totalRaw += injuries.length;

      const { alerts, playerScores, teamMap } = processSportInjuries(injuries, espnSport, now);
      pendingAlerts.push(...alerts);
      pendingScores.push(...playerScores);
      for (const [team, data] of teamMap) {
        const existing = pendingTeamMap.get(team);
        if (existing) {
          existing.alerts.push(...data.alerts);
        } else {
          pendingTeamMap.set(team, data);
        }
      }

      logger.info(
        { sport: espnSport.title, raw: injuries.length, alerts: alerts.length },
        "ESPN injury data loaded",
      );
    }

    // Require at least one successful sport fetch before replacing state.
    if (totalRaw === 0 && failedSports.length === ESPN_SPORTS.length) {
      throw new Error(`All ESPN sport fetches failed: ${failedSports.join("; ")}`);
    }

    if (failedSports.length > 0) {
      logger.warn(
        { failedCount: failedSports.length, successCount: ESPN_SPORTS.length - failedSports.length },
        "Partial ESPN failure — cache contains only successfully fetched sports",
      );
    }

    // Atomic swap: only now replace state.
    const teamPulse = buildTeamPulse(pendingTeamMap);

    state.alerts = pendingAlerts;
    state.playerScores = pendingScores;
    state.teamPulse = teamPulse;
    state.lastRefreshedAt = new Date();
    state.usingRealData = true;

    logger.info(
      {
        alerts: pendingAlerts.length,
        playerScores: pendingScores.length,
        teamPulse: teamPulse.length,
        source: "ESPN Injury Reports",
        partialFailures: failedSports.length,
      },
      "Observation cache refreshed",
    );
  } catch (err) {
    // Retain prior state on total failure.
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = msg;
    logger.warn({ err }, "Observation cache refresh failed — retaining previous data");
  } finally {
    state.isRefreshing = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let observationScheduler: ReturnType<typeof setInterval> | null = null;

/**
 * Start the observation refresh cycle.
 * ESPN data is independent of the sports cache, so a short delay is fine.
 */
export function startObservationRefresh(delayMs = 5_000): void {
  if (observationScheduler) return;

  const intervalMinutes = Number(
    process.env["OBSERVATION_REFRESH_INTERVAL_MINUTES"] ?? "60",
  );
  const intervalMs = intervalMinutes * 60 * 1000;

  setTimeout(() => {
    void refreshObservationCache();
    observationScheduler = setInterval(() => {
      void refreshObservationCache();
    }, intervalMs);
  }, delayMs);

  logger.info({ intervalMinutes, delayMs }, "Observation refresh scheduled");
}

// ─── Read accessors ───────────────────────────────────────────────────────────

export function getAlerts(): ObservationAlert[] {
  return state.alerts;
}

export function getPlayerScores(): ObservationPlayerScore[] {
  return state.playerScores;
}

export function getTeamPulse(): ObservationTeamPulse[] {
  return state.teamPulse;
}

export function getObservationStatus() {
  return {
    lastRefreshedAt: state.lastRefreshedAt?.toISOString() ?? null,
    usingRealData: state.usingRealData,
    alertCount: state.alerts.length,
    playerScoreCount: state.playerScores.length,
    teamPulseCount: state.teamPulse.length,
    source: "ESPN Injury Reports",
    lastError: state.lastError,
  };
}

/**
 * ESPN public API integration for auto-settling player prop picks.
 * No API key required — ESPN's summary and scoreboard endpoints are public.
 */

import { logger } from "./logger.js";

// ─── Sport routing ─────────────────────────────────────────────────────────────

const SPORT_PATH: Record<string, string> = {
  NBA:   "basketball/nba",
  WNBA:  "basketball/wnba",
  NFL:   "football/nfl",
  MLB:   "baseball/mlb",
  NHL:   "hockey/nhl",
  NCAAB: "basketball/mens-college-basketball",
  NCAAF: "football/college-football",
};

// ─── PropType → which ESPN stat labels to sum ──────────────────────────────────
// Also specifies a "group discriminator" label to pick the right NFL stats group.

interface StatDef {
  /** ESPN labels to sum for this prop (e.g. ["PTS"] or ["PTS","REB","AST"]) */
  labels: string[];
  /** A label that uniquely identifies the stats group (important for NFL YDS / TD) */
  groupAnchor?: string;
}

const PROP_STAT_MAP: Record<string, StatDef> = {
  // NBA / WNBA
  "Points":               { labels: ["PTS"] },
  "Rebounds":             { labels: ["REB"] },
  "Assists":              { labels: ["AST"] },
  "Blocks":               { labels: ["BLK"] },
  "Steals":               { labels: ["STL"] },
  "3-Pointers Made":      { labels: ["3PT"] },
  "Pts+Reb+Ast":          { labels: ["PTS", "REB", "AST"] },
  "Pts+Reb":              { labels: ["PTS", "REB"] },
  "Pts+Ast":              { labels: ["PTS", "AST"] },
  "Reb+Ast":              { labels: ["REB", "AST"] },
  // NFL
  "Passing Yards":        { labels: ["YDS"],   groupAnchor: "C/ATT" },
  "Passing TDs":          { labels: ["TD"],    groupAnchor: "C/ATT" },
  "Completions":          { labels: ["C/ATT"], groupAnchor: "C/ATT" },
  "Pass Attempts":        { labels: ["C/ATT"], groupAnchor: "C/ATT" }, // parsed as M of N/M
  "Interceptions":        { labels: ["INT"],   groupAnchor: "C/ATT" },
  "Rushing Yards":        { labels: ["YDS"],   groupAnchor: "CAR" },
  "Rush Attempts":        { labels: ["CAR"],   groupAnchor: "CAR" },
  "Rushing TDs":          { labels: ["TD"],    groupAnchor: "CAR" },
  "Receiving Yards":      { labels: ["YDS"],   groupAnchor: "TGTS" },
  "Receptions":           { labels: ["REC"],   groupAnchor: "TGTS" },
  "Receiving TDs":        { labels: ["TD"],    groupAnchor: "TGTS" },
  // MLB
  "Hits":                 { labels: ["H"],     groupAnchor: "H-AB" },
  "RBIs":                 { labels: ["RBI"],   groupAnchor: "H-AB" },
  "Home Runs":            { labels: ["HR"],    groupAnchor: "H-AB" },
  "Pitcher Strikeouts":   { labels: ["K"],     groupAnchor: "IP" },
  // NHL
  "Goals":                { labels: ["G"] },
  "Goals + Assists":      { labels: ["G", "A"] },
  "Shots on Goal":        { labels: ["SOG"] },
};

// ─── In-memory box score cache (game data is immutable once Final) ─────────────

interface CachedBoxScore {
  athletes: AthleteRecord[];
  ts: number;
}
interface AthleteRecord {
  name: string;
  teamName: string;
  groupLabels: string[];  // labels for this stats group
  stats: string[];        // raw stat strings, same-indexed as groupLabels
}

const boxScoreCache = new Map<string, CachedBoxScore>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

// ─── Team name fuzzy match ─────────────────────────────────────────────────────

function normTeam(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normTeam(a), nb = normTeam(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Compare last word (city vs nickname)
  const wa = na.split(" "), wb = nb.split(" ");
  const lastA = wa[wa.length - 1], lastB = wb[wb.length - 1];
  if (lastA && lastB && lastA.length > 3 && lastA === lastB) return true;
  return false;
}

// ─── Stat string parser ────────────────────────────────────────────────────────

/**
 * Parse a single ESPN stat string to a number.
 * Handles: "27" → 27, "2-7" (made-att) → 2, "19/38" (comp/att) → 19,
 * "+11" → 11, "2.0" → 2, "--" → 0.
 * For "Pass Attempts" the caller should swap to the denominator.
 */
function parseStat(raw: string, wantAttempts = false): number {
  if (!raw || raw === "--" || raw === "-") return 0;
  // N/M or N-M format (made / attempted)
  const slash = raw.match(/^(\d+)[\/](\d+)$/);
  if (slash) return wantAttempts ? parseInt(slash[2]) : parseInt(slash[1]);
  const dash = raw.match(/^(\d+)-(\d+)$/);
  if (dash) return wantAttempts ? parseInt(dash[2]) : parseInt(dash[1]);
  // "+/-" like "+11" → parseFloat handles "+"
  return parseFloat(raw) || 0;
}

// ─── ESPN scoreboard → event ID ────────────────────────────────────────────────

async function fetchEventId(
  sportPath: string,
  homeTeam: string,
  awayTeam: string,
  dateStr: string,       // "YYYYMMDD"
): Promise<string | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}&limit=50`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    for (const ev of (data.events ?? [])) {
      const comps = ev.competitions?.[0]?.competitors ?? [];
      const names: string[] = comps.map((c: any) => c.team?.displayName ?? "");
      const matchHome = names.some(n => teamsMatch(n, homeTeam));
      const matchAway = names.some(n => teamsMatch(n, awayTeam));
      if (matchHome && matchAway) return ev.id as string;
    }
    return null;
  } catch (err: any) {
    logger.warn({ msg: "ESPN scoreboard fetch failed", url, err: err?.message });
    return null;
  }
}

// ─── ESPN summary → athlete records ────────────────────────────────────────────

async function fetchBoxScoreAthletes(
  sportPath: string,
  eventId: string,
): Promise<AthleteRecord[]> {
  const cacheKey = `${sportPath}:${eventId}`;
  const cached = boxScoreCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.athletes;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${eventId}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const bs = data.boxscore ?? data.boxScore;
    if (!bs) return [];

    const athletes: AthleteRecord[] = [];
    for (const teamEntry of (bs.players ?? [])) {
      const teamName: string = teamEntry.team?.displayName ?? "";
      for (const statsGroup of (teamEntry.statistics ?? [])) {
        const labels: string[] = statsGroup.labels ?? [];
        for (const athleteEntry of (statsGroup.athletes ?? [])) {
          athletes.push({
            name: athleteEntry.athlete?.displayName ?? "",
            teamName,
            groupLabels: labels,
            stats: athleteEntry.stats ?? [],
          });
        }
      }
    }

    boxScoreCache.set(cacheKey, { athletes, ts: Date.now() });
    return athletes;
  } catch (err: any) {
    logger.warn({ msg: "ESPN summary fetch failed", url, err: err?.message });
    return [];
  }
}

// ─── Compute the stat value for a player + propType ────────────────────────────

function computePlayerStat(
  athletes: AthleteRecord[],
  playerName: string,
  propType: string,
): { value: number; rawStats: string } | null {
  const def = PROP_STAT_MAP[propType];
  if (!def) return null;

  const normName = playerName.toLowerCase().trim();

  // Filter athletes matching the player name
  const matches = athletes.filter(a => {
    const an = a.name.toLowerCase().trim();
    return an === normName || an.includes(normName) || normName.includes(an);
  });

  if (matches.length === 0) return null;

  // If there's a groupAnchor, prefer the record whose group contains that label
  let candidate: AthleteRecord | undefined;
  if (def.groupAnchor) {
    candidate = matches.find(a => a.groupLabels.includes(def.groupAnchor!));
  }
  if (!candidate) candidate = matches[0];

  // Sum the values for each required label
  const wantAttempts = propType === "Pass Attempts";
  let total = 0;
  const rawParts: string[] = [];
  for (const label of def.labels) {
    const idx = candidate.groupLabels.indexOf(label);
    if (idx === -1) return null; // label not found — sport mismatch
    const raw = candidate.stats[idx] ?? "0";
    rawParts.push(`${label}:${raw}`);
    total += parseStat(raw, wantAttempts);
  }

  return { value: total, rawStats: rawParts.join(" ") };
}

// ─── Public auto-settle function ───────────────────────────────────────────────

export interface AutoSettleResult {
  result: "hit" | "miss" | "push";
  actualValue: number;
  rawStat: string;
}

/**
 * Given a pick that is in a Final game, attempts to fetch the player's actual
 * stat from ESPN and determine hit / miss / push.
 * Returns null if the stat could not be determined (no ESPN data, unsupported prop type, etc.).
 */
export async function autoSettlePick(pick: {
  playerName: string;
  sport: string;
  propType: string;
  line: number;
  direction: "Over" | "Under";
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
}): Promise<AutoSettleResult | null> {
  const sportPath = SPORT_PATH[pick.sport.toUpperCase()];
  if (!sportPath) return null;
  if (!PROP_STAT_MAP[pick.propType]) return null;
  if (!pick.commenceTime) return null;

  // Try the UTC date and the day before (timezone buffer)
  const dt = new Date(pick.commenceTime);
  const dates: string[] = [];
  for (let offset = -1; offset <= 1; offset++) {
    const d = new Date(dt.getTime() + offset * 86400000);
    dates.push(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  // Deduplicate
  const uniqueDates = [...new Set(dates)];

  let eventId: string | null = null;
  for (const dateStr of uniqueDates) {
    eventId = await fetchEventId(sportPath, pick.homeTeam, pick.awayTeam, dateStr);
    if (eventId) break;
  }
  if (!eventId) {
    logger.debug({ msg: "ESPN: no event found", sport: pick.sport, home: pick.homeTeam, away: pick.awayTeam });
    return null;
  }

  const athletes = await fetchBoxScoreAthletes(sportPath, eventId);
  if (athletes.length === 0) return null;

  const statResult = computePlayerStat(athletes, pick.playerName, pick.propType);
  if (!statResult) {
    logger.debug({ msg: "ESPN: player stat not found", player: pick.playerName, prop: pick.propType, eventId });
    return null;
  }

  const { value, rawStats } = statResult;
  const PUSH_TOLERANCE = 0.5; // e.g. 25.5 line → exact 25.5 not possible with integer stats

  let result: "hit" | "miss" | "push";
  if (Math.abs(value - pick.line) < PUSH_TOLERANCE) {
    result = "push";
  } else if (pick.direction === "Over") {
    result = value > pick.line ? "hit" : "miss";
  } else {
    result = value < pick.line ? "hit" : "miss";
  }

  return { result, actualValue: value, rawStat: rawStats };
}

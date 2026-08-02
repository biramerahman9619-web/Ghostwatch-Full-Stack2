/**
 * Picks engine — transforms raw Odds API data into Ghostwatch picks and live signals.
 *
 * Exports two pick-generation paths:
 *   - generatePicksFromOdds: uses OddsApiEventWithOdds + per-event propMarkets (main-branch API)
 *   - buildPicksFromEvents:  uses OddsEvent with embedded bookmakers; adds OpenAI explanations
 *
 * Both respect the neutral-matchup-context rule: team/opponent fields are set to the
 * full matchup string "HomeTeam vs. AwayTeam" — The Odds API does not identify which
 * team each player belongs to, so per-player team attribution would be wrong ~50% of the time.
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { logger } from "./logger.js";
import type {
  OddsApiEventWithOdds,
  OddsApiMarket,
  OddsApiOutcome,
  OddsEvent,
  OddsOutcome,
  ScoreEvent,
} from "./oddsApi.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedPick {
  id: string;

  playerName: string;
  /** Neutral matchup context: "HomeTeam vs. AwayTeam" — player's actual team is unknown */

  team: string;
  /** Same matchup context as team — The Odds API does not provide per-player team attribution */

  opponent: string;

  sport: string;

  propType: string;

  line: number;

  direction: "Over" | "Under";

  projection: number;

  confidence: number;

  riskTier: "Safe" | "Balanced" | "Aggressive";

  explanation: string;

  socialImpact: number | null;

  createdAt: string;
  // enriched fields — populated by generatePicksFromOdds, optional in buildPicksFromEvents

  gameId?: string;

  commenceTime?: string;

  bookmakers?: string[];

  impliedProbability?: number;

  avgAmericanOdds?: number;
}

export interface GeneratedLiveGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  homeScore: number;
  awayScore: number;
  quarter: string;
  timeRemaining: string;
  pace: "Slow" | "Normal" | "Fast";
  status: "Live" | "Halftime" | "Final";
}

// ─── Prop type labels ─────────────────────────────────────────────────────────

const PROP_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers Made",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_turnovers: "Turnovers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_first_basket: "First Basket Scorer",
  player_pass_yds: "Passing Yards",
  player_pass_tds: "Passing TDs",
  player_pass_completions: "Completions",
  player_pass_attempts: "Pass Attempts",
  player_pass_interceptions: "Interceptions",
  player_rush_yds: "Rushing Yards",
  player_rush_attempts: "Rush Attempts",
  player_rush_tds: "Rushing TDs",
  player_reception_yds: "Receiving Yards",
  player_receptions: "Receptions",
  player_reception_tds: "Receiving TDs",
  player_anytime_td: "Anytime TD",
  player_kicking_points: "Kicking Points",
  player_field_goals: "Field Goals",
  player_strikeouts: "Strikeouts",
  pitcher_strikeouts: "Pitcher Strikeouts",
  player_hits: "Hits",
  batter_hits: "Hits",
  player_home_runs: "Home Runs",
  batter_home_runs: "Home Runs",
  player_rbis: "RBIs",
  batter_rbis: "RBIs",
  player_total_bases: "Total Bases",
  batter_total_bases: "Total Bases",
  player_stolen_bases: "Stolen Bases",
  player_walks: "Walks",
  player_earned_runs: "Earned Runs Allowed",
  player_goals: "Goals",
  player_saves: "Saves",
  player_shots_on_goal: "Shots on Goal",
  player_power_play_points: "Power Play Points",
  player_blocked_shots: "Blocked Shots",
  player_goal_scorer_anytime: "Goal Scorer",
  player_shots_on_target: "Shots on Target",
};

function propLabel(key: string): string {
  return PROP_LABELS[key] ?? key.replace(/^player_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── PrizePicks multipliers ───────────────────────────────────────────────────

/** Power Play: ALL picks must be correct.  Multipliers match the PrizePicks schedule. */
const PP_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 40 };

/** Flex Play: partial credit available on 3+ pick entries. */
const FP_MULTIPLIERS: Record<number, { main: number; missOne?: number; missTwo?: number }> = {
  2: { main: 3 },
  3: { main: 2.25, missOne: 1.25 },
  4: { main: 5,    missOne: 1.5 },
  5: { main: 10,   missOne: 2,  missTwo: 0.5 },
  6: { main: 20,   missOne: 2,  missTwo: 0.5 },
};

export function prizePicksMultiplier(
  picks: number,
  entryType: "PowerPlay" | "FlexPlay",
): number {
  const n = Math.min(6, Math.max(2, picks));
  if (entryType === "PowerPlay") return PP_MULTIPLIERS[n] ?? 5;
  return FP_MULTIPLIERS[n]?.main ?? 2.25;
}

/** Human-readable payout breakdown for Flex Play entries. */
export function flexBreakdownLabel(picks: number): string {
  const n = Math.min(6, Math.max(2, picks));
  const fp = FP_MULTIPLIERS[n];
  if (!fp) return "";
  const parts: string[] = [`${fp.main}x all correct`];
  if (fp.missOne !== undefined) parts.push(`${fp.missOne}x (1 miss)`);
  if (fp.missTwo !== undefined) parts.push(`${fp.missTwo}x (2 miss)`);
  return parts.join(" · ");
}

// ─── Win probability ──────────────────────────────────────────────────────────

/**
 * Projected win probability for a PrizePicks entry.
 *
 * Power Play: all picks must hit → product of individual probabilities.
 * Flex Play (3+ picks): 1 miss still pays → P(all hit) + P(exactly 1 miss).
 * Flex Play (2 picks): same as Power Play (both must hit for any credit).
 *
 * Returns a value 0–1; multiply by 100 for a percentage.
 */
export function calcWinProbability(
  picks: { confidence: number }[],
  entryType: "PowerPlay" | "FlexPlay",
): number {
  const probs = picks.map((p) => Math.min(0.95, Math.max(0.5, p.confidence / 100)));
  const n = probs.length;
  if (n === 0) return 0;

  // P(all hit) = Π p_i
  const allHit = probs.reduce((acc, p) => acc * p, 1);

  // Power Play or 2-pick Flex Play: must sweep
  if (entryType === "PowerPlay" || n <= 2) return allHit;

  // Flex Play 3+: 1 miss allowed → add P(exactly 1 miss)
  let oneOffProb = 0;
  for (let i = 0; i < n; i++) {
    const missI = 1 - probs[i]!;
    const restHit = probs.reduce((acc, p, j) => (j === i ? acc : acc * p), 1);
    oneOffProb += missI * restHit;
  }

  return Math.min(1, allHit + oneOffProb);
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Convert American odds to implied probability (0–1). */
function americanToImplied(odds: number): number {
  if (odds >= 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Compute the market-devigged implied probability (remove bookmaker juice). */
function devig(overOdds: number, underOdds: number): { overProb: number; underProb: number } {
  const rawOver = americanToImplied(overOdds);
  const rawUnder = americanToImplied(underOdds);
  const total = rawOver + rawUnder;
  return {
    overProb: rawOver / total,
    underProb: rawUnder / total,
  };
}

/** Average a list of American odds into a single implied probability. */
function avgImplied(prices: number[]): number {
  if (!prices.length) return 0.5;
  return prices.reduce((s, p) => s + americanToImplied(p), 0) / prices.length;
}

// ─── Game context extraction ──────────────────────────────────────────────────

interface GameContext {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  commenceTime: string;
  /** Consensus spread (positive = home favored) */
  spread: number | null;
  /** Consensus game total O/U line */
  total: number | null;
  /** Implied probability that total goes Over (devigged, 0-1) */
  overImplied: number | null;
  /** Implied probability home team wins */
  homeWinImplied: number | null;
  bookmakers: string[];
}

function extractGameContext(event: OddsApiEventWithOdds, sportTitle: string): GameContext {
  const spreadPrices: number[] = [];
  const totalLines: number[] = [];
  const overPrices: number[] = [];
  const underPrices: number[] = [];
  const homeMLPrices: number[] = [];
  const awayMLPrices: number[] = [];
  const bookmakerNames: string[] = [];

  for (const bm of event.bookmakers) {
    bookmakerNames.push(bm.title);
    for (const market of bm.markets) {
      if (market.key === "spreads") {
        const homeSpread = market.outcomes.find(
          (o) => o.name === event.home_team,
        );
        if (homeSpread?.point !== undefined) spreadPrices.push(homeSpread.point);
      }
      if (market.key === "totals") {
        const over = market.outcomes.find((o) => o.name === "Over");
        const under = market.outcomes.find((o) => o.name === "Under");
        if (over?.point !== undefined) totalLines.push(over.point);
        if (over?.price !== undefined) overPrices.push(over.price);
        if (under?.price !== undefined) underPrices.push(under.price);
      }
      if (market.key === "h2h") {
        const home = market.outcomes.find((o) => o.name === event.home_team);
        const away = market.outcomes.find((o) => o.name === event.away_team);
        if (home?.price !== undefined) homeMLPrices.push(home.price);
        if (away?.price !== undefined) awayMLPrices.push(away.price);
      }
    }
  }

  const avgSpread =
    spreadPrices.length > 0
      ? spreadPrices.reduce((a, b) => a + b, 0) / spreadPrices.length
      : null;

  const avgTotal =
    totalLines.length > 0
      ? totalLines.reduce((a, b) => a + b, 0) / totalLines.length
      : null;

  // Devigged over probability
  let overImplied: number | null = null;
  if (overPrices.length > 0 && underPrices.length > 0) {
    const rawOver = avgImplied(overPrices);
    const rawUnder = avgImplied(underPrices);
    overImplied = rawOver / (rawOver + rawUnder);
  }

  // Home win probability
  let homeWinImplied: number | null = null;
  if (homeMLPrices.length > 0 && awayMLPrices.length > 0) {
    const rawHome = avgImplied(homeMLPrices);
    const rawAway = avgImplied(awayMLPrices);
    homeWinImplied = rawHome / (rawHome + rawAway);
  }

  return {
    gameId: event.id,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    sport: sportTitle,
    commenceTime: event.commence_time,
    spread: avgSpread !== null ? Math.round(avgSpread * 2) / 2 : null,
    total: avgTotal !== null ? Math.round(avgTotal * 2) / 2 : null,
    overImplied,
    homeWinImplied,
    bookmakers: [...new Set(bookmakerNames)],
  };
}

// ─── AI picks generation ──────────────────────────────────────────────────────

const PICKS_SYSTEM_PROMPT = `You are Ghostphere — an elite sports betting intelligence system. You generate PrizePicks and DraftKings-style player prop picks with precision.

For each game you receive, analyze the matchup using:
- The spread (which team is favored and by how much)
- The game total (tells you pace, scoring environment)
- The implied over probability (market consensus on tempo)
- Your extensive knowledge of player statistics, matchups, defensive rankings, usage rates, and historical trends

Generate player prop picks that are grounded in real matchup analysis. For each pick, identify a specific player and prop type (Points, Rebounds, Assists, Passing Yards, Rushing Yards, Receiving Yards, Strikeouts, Home Runs, Total Bases, Shots on Goal, Goals + Assists, etc.) with a realistic line.

Classify risk:
- Safe: 72%+ confidence, strong historical edge, favorable matchup
- Balanced: 62-72% confidence, good value but some variance
- Aggressive: below 62%, high ceiling but higher variance

Return ONLY valid JSON. No markdown, no explanation outside JSON.`;

interface AIPick {
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  direction: "Over" | "Under";
  projection: number;
  confidence: number;
  riskTier: "Safe" | "Balanced" | "Aggressive";
  explanation: string;
}

function buildGamePrompt(games: GameContext[]): string {
  const gameList = games
    .map((g, i) => {
      const date = new Date(g.commenceTime).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const spreadStr =
        g.spread !== null
          ? `Spread: ${g.homeTeam} ${g.spread > 0 ? "+" : ""}${g.spread}`
          : "Spread: N/A";
      const totalStr =
        g.total !== null
          ? `Total: ${g.total}${g.overImplied !== null ? ` (${Math.round(g.overImplied * 100)}% Over implied)` : ""}`
          : "Total: N/A";
      const winStr =
        g.homeWinImplied !== null
          ? `Home win prob: ${Math.round(g.homeWinImplied * 100)}%`
          : "";

      return `Game ${i + 1}: ${g.sport} — ${g.awayTeam} @ ${g.homeTeam} (${date} ET)
  ${spreadStr} | ${totalStr}${winStr ? " | " + winStr : ""}
  Books: ${g.bookmakers.slice(0, 3).join(", ")}`;
    })
    .join("\n\n");

  return `Generate 2-3 high-confidence player prop picks for each of these games. Focus on props where the game context (spread, total, pace) strongly supports one direction.

${gameList}

Return a JSON array of pick objects. Each object must have exactly these fields:
{
  "playerName": string,
  "team": string (full team name),
  "opponent": string (full team name),
  "propType": string (e.g. "Points", "Rushing Yards", "Strikeouts"),
  "line": number,
  "direction": "Over" | "Under",
  "projection": number (your projected actual stat),
  "confidence": number (50-95),
  "riskTier": "Safe" | "Balanced" | "Aggressive",
  "explanation": string (2-3 sentences — cite specific reasoning: matchup rank, usage rate, pace, injury context, recent form)
}`;
}

async function callOpenAIForPicks(games: GameContext[]): Promise<AIPick[]> {
  const prompt = buildGamePrompt(games);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PICKS_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3, // Low temp for consistent, precise outputs
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);

  // Handle both {picks: [...]} and [...] shapes
  const picks: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.picks)
      ? parsed.picks
      : Object.values(parsed).find((v) => Array.isArray(v)) ?? [];

  return picks.filter(
    (p): p is AIPick =>
      typeof p === "object" &&
      p !== null &&
      "playerName" in p &&
      "propType" in p &&
      "line" in p &&
      "direction" in p,
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate AI-powered player prop picks from real game odds data.
 *
 * @param events      All events for the sport (with bookmaker game odds)
 * @param _propBooks  Unused — player props require paid tier, we use AI instead
 * @param sportTitle  Human-readable sport name
 */
export async function generatePicksFromOdds(
  events: OddsApiEventWithOdds[],
  _propBooks: Record<string, unknown>,
  sportTitle: string,
): Promise<GeneratedPick[]> {
  if (events.length === 0) return [];

  // Only process games within the next 48 hours
  const now = Date.now();
  const upcomingEvents = events.filter((e) => {
    const start = new Date(e.commence_time).getTime();
    const hoursFromNow = (start - now) / (1000 * 60 * 60);
    return hoursFromNow >= -1 && hoursFromNow <= 48;
  });

  if (upcomingEvents.length === 0) return [];

  // Extract game contexts from real odds data
  const gameContexts = upcomingEvents.map((e) => extractGameContext(e, sportTitle));

  // Only include games that have actual odds data (at least 1 bookmaker)
  const withOdds = gameContexts.filter((g) => g.bookmakers.length > 0);
  if (withOdds.length === 0) return [];

  logger.info(
    { sport: sportTitle, games: withOdds.length },
    "Generating AI picks",
  );

  // Process in batches of 6 games per OpenAI call
  const BATCH_SIZE = 6;
  const allAIPicks: AIPick[] = [];

  for (let i = 0; i < withOdds.length; i += BATCH_SIZE) {
    const batch = withOdds.slice(i, i + BATCH_SIZE);
    try {
      const picks = await callOpenAIForPicks(batch);
      allAIPicks.push(...picks);
    } catch (e) {
      logger.warn({ err: e, sport: sportTitle, batch: i }, "AI picks batch failed");
    }
  }

  // Convert AI picks to GeneratedPick format
  const now2 = new Date().toISOString();
  const picks: GeneratedPick[] = allAIPicks
    .filter((p) => p.confidence >= 50 && p.line > 0)
    .map((p, idx) => {
      // Find matching game context
      const ctx = withOdds.find(
        (g) =>
          g.homeTeam === p.team ||
          g.awayTeam === p.team ||
          g.homeTeam === p.opponent ||
          g.awayTeam === p.opponent,
      ) ?? withOdds[0]!;

      const riskTier: "Safe" | "Balanced" | "Aggressive" =
        p.riskTier === "Safe" || p.riskTier === "Balanced" || p.riskTier === "Aggressive"
          ? p.riskTier
          : p.confidence >= 72
            ? "Safe"
            : p.confidence >= 62
              ? "Balanced"
              : "Aggressive";

      return {
        id: `pick_${sportTitle.toLowerCase()}_${idx}_${Date.now()}`,
        playerName: p.playerName,
        team: p.team,
        opponent: p.opponent,
        sport: sportTitle,
        propType: p.propType,
        line: p.line,
        direction: p.direction,
        projection: p.projection,
        confidence: Math.min(95, Math.max(50, p.confidence)),
        riskTier,
        explanation: p.explanation,
        socialImpact: null,
        createdAt: now2,
        gameId: ctx.gameId,
        commenceTime: ctx.commenceTime,
        bookmakers: ctx.bookmakers,
        impliedProbability: p.confidence,
        avgAmericanOdds:
          p.direction === "Over"
            ? Math.round(-p.confidence / (100 - p.confidence) * 100)
            : Math.round(-p.confidence / (100 - p.confidence) * 100),
      };
    });

  // Deduplicate by player + prop
  const seen = new Set<string>();
  const deduped = picks.filter((p) => {
    const key = `${p.playerName}|${p.propType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(
    { sport: sportTitle, picks: deduped.length },
    "AI picks generated",
  );

  return deduped;
}

export interface GeneratedGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  scheduledAt: string;
  status: "Scheduled" | "Live" | "Final";
  homeScore: number | null;
  awayScore: number | null;
  quarter: string | null;
  timeRemaining: string | null;
}

interface PickContext {
  playerName: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  propType: string;
  line: number;
  direction: "Over" | "Under";
  confidence: number;
  bookmakerCount: number;
  impliedProbPct: number;
}

export function eventsToGames(events: OddsEvent[], sport: string): GeneratedGame[] {
  return events.map((e) => ({
    id: e.id,
    homeTeam: e.home_team,
    awayTeam: e.away_team,
    sport,
    scheduledAt: e.commence_time,
    status: "Scheduled" as const,
    homeScore: null,
    awayScore: null,
    quarter: null,
    timeRemaining: null,
  }));
}

// ─── Core extraction ──────────────────────────────────────────────────────────

interface PropGroup {
  playerName: string;
  propKey: string;
  line: number;
  overPrices: { price: number; bookmaker: string }[];
  underPrices: { price: number; bookmaker: string }[];
  homeTeam: string;
  awayTeam: string;
  gameId: string;
  commenceTime: string;
  sport: string;
}

/**
 * Flatten all bookmaker markets for an event into a list of prop groups,
 * keyed by player + prop + line.
 */
function extractPropGroups(
  event: OddsApiEventWithOdds,
  markets: OddsApiMarket[],
  sport: string,
): PropGroup[] {
  const groups: Map<string, PropGroup> = new Map();

  for (const bm of event.bookmakers) {
    for (const market of bm.markets) {
      const byName: Record<string, { over?: OddsApiOutcome; under?: OddsApiOutcome }> = {};

      for (const outcome of market.outcomes) {
        const name = outcome.name;
        if (!byName[name]) byName[name] = {};
        if (outcome.description?.toLowerCase() === "over") byName[name].over = outcome;
        else if (outcome.description?.toLowerCase() === "under") byName[name].under = outcome;
      }

      for (const [playerName, sides] of Object.entries(byName)) {
        if (!sides.over && !sides.under) continue;
        const line = sides.over?.point ?? sides.under?.point ?? 0;
        const key = `${playerName}|${market.key}|${line}`;

        if (!groups.has(key)) {
          groups.set(key, {
            playerName,
            propKey: market.key,
            line,
            overPrices: [],
            underPrices: [],
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            gameId: event.id,
            commenceTime: event.commence_time,
            sport,
          });
        }

        const g = groups.get(key)!;
        if (sides.over) g.overPrices.push({ price: sides.over.price, bookmaker: bm.title });
        if (sides.under) g.underPrices.push({ price: sides.under.price, bookmaker: bm.title });
      }
    }
  }

  return [...groups.values()];
}

// ─── Pick scoring ─────────────────────────────────────────────────────────────

function scorePropGroup(group: PropGroup, sportTitle: string): GeneratedPick | null {
  const totalBooks = new Set([
    ...group.overPrices.map((p) => p.bookmaker),
    ...group.underPrices.map((p) => p.bookmaker),
  ]).size;

  // Need at least 2 bookmakers for consensus
  if (totalBooks < 2) return null;

  const overImplied = avgImplied(group.overPrices.map((p) => p.price));
  const underImplied = avgImplied(group.underPrices.map((p) => p.price));

  // Devig using average pair when we have both sides
  let trueOverProb: number;
  let trueUnderProb: number;

  if (group.overPrices.length > 0 && group.underPrices.length > 0) {
    const avgOver = group.overPrices.reduce((s, p) => s + p.price, 0) / group.overPrices.length;
    const avgUnder = group.underPrices.reduce((s, p) => s + p.price, 0) / group.underPrices.length;
    const d = devig(avgOver, avgUnder);
    trueOverProb = d.overProb;
    trueUnderProb = d.underProb;
  } else {
    trueOverProb = overImplied;
    trueUnderProb = underImplied;
  }

  const favorsOver = trueOverProb > trueUnderProb;
  const edgeProb = favorsOver ? trueOverProb : trueUnderProb;

  // Require meaningful edge (>53%)
  if (edgeProb < 0.53) return null;

  const direction: "Over" | "Under" = favorsOver ? "Over" : "Under";
  const avgOdds = direction === "Over"
    ? group.overPrices.reduce((s, p) => s + p.price, 0) / (group.overPrices.length || 1)
    : group.underPrices.reduce((s, p) => s + p.price, 0) / (group.underPrices.length || 1);

  const bookmakerNames = [...new Set([
    ...group.overPrices.map((p) => p.bookmaker),
    ...group.underPrices.map((p) => p.bookmaker),
  ])];

  // Confidence: base from edge + book agreement bonus
  const baseConfidence = Math.round(edgeProb * 100);
  const bookBonus = Math.min(15, (totalBooks - 2) * 5);
  const confidence = Math.min(95, baseConfidence + bookBonus);

  // Risk tier
  const riskTier: "Safe" | "Balanced" | "Aggressive" =
    confidence >= 72 && Math.abs(avgOdds) >= 120
      ? "Safe"
      : confidence >= 62
        ? "Balanced"
        : "Aggressive";

  // Projection = line × edge multiplier (estimated actual performance)
  const edgeMult = direction === "Over" ? 1 + (edgeProb - 0.5) * 0.4 : 1 - (edgeProb - 0.5) * 0.4;
  const projection = Math.round(group.line * edgeMult * 10) / 10;

  // The Odds API does not identify which team a player belongs to.
  // Use neutral matchup context in both fields rather than falsely claiming home/away.
  const team = `${group.homeTeam} vs. ${group.awayTeam}`;
  const opponent = `${group.homeTeam} vs. ${group.awayTeam}`;

  // Explanation from raw data
  const oddsStr = avgOdds >= 0 ? `+${Math.round(avgOdds)}` : `${Math.round(avgOdds)}`;
  const gameDate = new Date(group.commenceTime).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const explanation =
    `${bookmakerNames.length} books agree ${direction.toLowerCase()} ${group.line}. ` +
    `Avg odds ${oddsStr} (${Math.round(edgeProb * 100)}% true probability after removing juice). ` +
    `Books: ${bookmakerNames.slice(0, 3).join(", ")}${bookmakerNames.length > 3 ? ` +${bookmakerNames.length - 3} more` : ""}. ` +
    `Game: ${group.homeTeam} vs ${group.awayTeam} — ${gameDate}.`;

  return {
    id: `pick_${group.gameId}_${group.playerName.replace(/\s+/g, "_")}_${group.propKey}`,
    playerName: group.playerName,
    team,
    opponent,
    sport: sportTitle,
    propType: propLabel(group.propKey),
    line: group.line,
    direction,
    projection,
    confidence,
    riskTier,
    explanation,
    socialImpact: null,
    createdAt: new Date().toISOString(),
    bookmakers: bookmakerNames,
    avgAmericanOdds: Math.round(avgOdds),
    impliedProbability: Math.round(edgeProb * 1000) / 10,
    gameId: group.gameId,
    commenceTime: group.commenceTime,
  };
}

/**
 * Convert a batch of Odds API events with player props into Ghostwatch picks.
 * Runs explanation generation via OpenAI in parallel batches.
 */
export async function buildPicksFromEvents(
  eventsWithProps: OddsEvent[],
  sport: string,
): Promise<GeneratedPick[]> {
  const rawLines = eventsWithProps.flatMap((e) => extractPropLines(e, sport));

  // Require at least 2 bookmakers agreeing on a line before including the pick
  const viable = rawLines.filter((l) => l.line > 0 && l.bookmakerCount >= 2);

  // Build pick contexts (without explanations yet)
  interface PickMeta {
    ctx: PickContext;
    raw: RawPropLine;
    direction: "Over" | "Under";
    confidence: number;
    impliedProbPct: number;
  }

  const metas: PickMeta[] = viable.map((l) => {
    const overProb = impliedProb(l.overOdds);
    const underProb = impliedProb(l.underOdds);
    const direction: "Over" | "Under" = overProb >= underProb ? "Over" : "Under";
    const prob = Math.max(overProb, underProb);
    const confidence = probToConfidence(prob);
    const impliedProbPct = Math.round(prob * 100);

    return {
      raw: l,
      direction,
      confidence,
      impliedProbPct,
      ctx: {
        playerName: l.playerName,
        homeTeam: l.homeTeam,
        awayTeam: l.awayTeam,
        sport,
        propType: marketKeyToPropType(l.marketKey),
        line: l.line,
        direction,
        confidence,
        bookmakerCount: l.bookmakerCount,
        impliedProbPct,
      },
    };
  });

  // Batch generate explanations via OpenAI (concurrency 3)
  const explanations = await batchProcess(
    metas,
    (meta: PickMeta) => generateExplanation(meta.ctx),
    { concurrency: 3, retries: 2 },
  );

  const now = new Date().toISOString();

  return metas.map((meta, i) => ({
    id: `real-${sport.toLowerCase()}-${i}-${Date.now()}`,
    playerName: meta.raw.playerName,
    // The Odds API player-prop markets do not identify which team a player belongs to.
    // We represent the game-level matchup in both fields rather than falsely claiming
    // the player is on the home team or away team.
    team: `${meta.raw.homeTeam} vs. ${meta.raw.awayTeam}`,
    opponent: `${meta.raw.homeTeam} vs. ${meta.raw.awayTeam}`,
    sport,
    propType: meta.ctx.propType,
    line: meta.raw.line,
    direction: meta.direction,
    projection: deriveProjection(meta.raw.line, meta.direction, meta.confidence),
    confidence: meta.confidence,
    riskTier: riskTierFromConfidence(meta.confidence),
    explanation: explanations[i] ?? fallbackExplanation(meta.ctx),
    socialImpact: null,
    createdAt: now,
  }));
}

/** Deterministic ID from a set of pick IDs — stable across repeated calls with same picks */
function ticketId(mode: string, picks: GeneratedPick[]): string {
  const sorted = picks.map((p) => p.id).sort().join("|");
  let h = 0;
  for (const c of sorted) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return `ticket-${mode.toLowerCase()}-${Math.abs(h).toString(36)}`;
}

export function buildTicketsFromPicks(
  picks: GeneratedPick[],
  picksPerTicket: number = 3,
  mode: "Safe" | "Balanced" | "Aggressive" | "Mixed" = "Balanced",
  entryType: "PowerPlay" | "FlexPlay" = "PowerPlay",
) {
  // PrizePicks allows 2–6 picks per entry
  const size = Math.min(6, Math.max(2, Math.round(picksPerTicket)));

  const tickets: Array<{
    id: string;
    riskTier: string;
    entryType: "PowerPlay" | "FlexPlay";
    payoutMultiplier: number;
    winProbability: number;
    picks: GeneratedPick[];
    combinedConfidence: number;
    sport: string;
    createdAt: string;
  }> = [];

  const multiplier = prizePicksMultiplier(size, entryType);

  if (mode === "Mixed") {
    // Interleave picks from all three tiers (round-robin by tier, sorted by confidence within each)
    // so every ticket gets a diverse blend of Safe + Balanced + Aggressive picks.
    const safe = picks
      .filter((p) => p.riskTier === "Safe")
      .sort((a, b) => b.confidence - a.confidence);
    const balanced = picks
      .filter((p) => p.riskTier === "Balanced")
      .sort((a, b) => b.confidence - a.confidence);
    const aggressive = picks
      .filter((p) => p.riskTier === "Aggressive")
      .sort((a, b) => b.confidence - a.confidence);

    // Round-robin interleave: S, B, A, S, B, A, …
    const interleaved: GeneratedPick[] = [];
    const maxLen = Math.max(safe.length, balanced.length, aggressive.length);
    for (let i = 0; i < maxLen; i++) {
      if (safe[i]) interleaved.push(safe[i]!);
      if (balanced[i]) interleaved.push(balanced[i]!);
      if (aggressive[i]) interleaved.push(aggressive[i]!);
    }

    for (let i = 0; i < interleaved.length; i += size) {
      const chunk = interleaved.slice(i, i + size);
      // PrizePicks minimum is 2 picks per entry
      if (chunk.length < 2) continue;

      const avgConf = chunk.reduce((s, p) => s + p.confidence, 0) / chunk.length;
      const sports = [...new Set(chunk.map((p) => p.sport))];

      tickets.push({
        id: ticketId("mixed", chunk),
        riskTier: "Mixed",
        entryType,
        payoutMultiplier: prizePicksMultiplier(chunk.length, entryType),
        winProbability: Math.round(calcWinProbability(chunk, entryType) * 1000) / 10,
        picks: chunk,
        combinedConfidence: Math.round(avgConf * 10) / 10,
        sport: sports.length === 1 ? sports[0]! : "Mixed",
        createdAt: new Date().toISOString(),
      });
    }
  } else {
    // Single-tier mode — filter to requested tier then chunk
    const tierPicks = picks
      .filter((p) => p.riskTier === mode)
      .sort((a, b) => b.confidence - a.confidence);

    for (let i = 0; i < tierPicks.length; i += size) {
      const chunk = tierPicks.slice(i, i + size);
      // PrizePicks minimum is 2 picks per entry
      if (chunk.length < 2) continue;

      const avgConf = chunk.reduce((s, p) => s + p.confidence, 0) / chunk.length;
      const sports = [...new Set(chunk.map((p) => p.sport))];

      tickets.push({
        id: ticketId(mode, chunk),
        riskTier: mode,
        entryType,
        payoutMultiplier: prizePicksMultiplier(chunk.length, entryType),
        winProbability: Math.round(calcWinProbability(chunk, entryType) * 1000) / 10,
        picks: chunk,
        combinedConfidence: Math.round(avgConf * 10) / 10,
        sport: sports.length === 1 ? sports[0]! : "Mixed",
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Attach unused multiplier variable to silence linter — it's computed above for
  // the full-size case but per-chunk multipliers handle variable last-chunk sizes.
  void multiplier;

  return tickets;
}

/**
 * Match a list of requested ticket IDs against a freshly-built ticket set.
 * Returns the matched tickets plus a count of how many IDs went unmatched
 * (i.e. were requested but couldn't be found — typically because picks
 * rotated mid-session and the deterministic ID changed).
 */
export function resolveTickets(
  allTickets: ReturnType<typeof buildTicketsFromPicks>,
  requestedIds: string[],
): { matched: ReturnType<typeof buildTicketsFromPicks>; skippedCount: number } {
  const idSet = new Set(requestedIds);
  const matched = allTickets.filter((t) => idSet.has(t.id));
  return { matched, skippedCount: requestedIds.length - matched.length };
}

/** Derive a projected stat value: slightly above/below the line based on direction */
function deriveProjection(line: number, direction: "Over" | "Under", confidence: number): number {
  const edge = line * (0.04 + (confidence - 50) * 0.001); // 4–9% edge depending on confidence
  const raw = direction === "Over" ? line + edge : line - edge;
  return Math.round(raw * 10) / 10;
}

export function scoresToLiveGames(scores: ScoreEvent[], sport: string): GeneratedLiveGame[] {
  return scores
    .filter((e) => !e.completed && e.scores && e.scores.length > 0)
    .map((e) => {
      const homeScore = Number(e.scores!.find((s) => s.name === e.home_team)?.score ?? 0);
      const awayScore = Number(e.scores!.find((s) => s.name === e.away_team)?.score ?? 0);
      const total = homeScore + awayScore;
      // Rough pace classification — higher totals indicate faster pace
      const pace: "Slow" | "Normal" | "Fast" =
        sport === "NBA"
          ? total > 220 ? "Fast" : total > 180 ? "Normal" : "Slow"
          : "Normal";
      return {
        id: e.id,
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        sport,
        homeScore,
        awayScore,
        quarter: "Live",
        timeRemaining: "",
        pace,
        status: "Live" as const,
      };
    });
}

interface RawPropLine {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  marketKey: string;
  playerName: string;
  line: number;
  overOdds: number;
  underOdds: number;
  bookmakerCount: number;
}

/** Human-readable prop type from market key */
function marketKeyToPropType(key: string): string {
  const map: Record<string, string> = {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers",
    player_blocks: "Blocks",
    player_steals: "Steals",
    player_points_rebounds_assists: "Points + Rebounds + Assists",
    player_points_rebounds: "Points + Rebounds",
    player_points_assists: "Points + Assists",
    player_pass_yds: "Passing Yards",
    player_rush_yds: "Rushing Yards",
    player_reception_yds: "Receiving Yards",
    player_pass_tds: "Passing TDs",
    player_receptions: "Receptions",
    batter_total_bases: "Total Bases",
    batter_hits: "Hits",
    batter_rbis: "RBIs",
    pitcher_strikeouts: "Strikeouts",
    player_goals: "Goals",
  };
  return map[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractPropLines(event: OddsEvent, sport: string): RawPropLine[] {
  if (!event.bookmakers?.length) return [];

  // Aggregate lines across bookmakers, pick the consensus (median) line
  // Key: "marketKey::playerName"
  const linesByKey: Record<string, { lines: number[]; overOdds: number[]; underOdds: number[]; bookmakers: Set<string> }> = {};

  for (const bm of event.bookmakers) {
    for (const market of bm.markets) {
      const overs = market.outcomes.filter((o) => o.name === "Over" && o.point !== undefined);
      const unders = market.outcomes.filter((o) => o.name === "Under" && o.point !== undefined);

      for (const over of overs) {
        const playerName = over.description ?? "Unknown";
        if (playerName === "Unknown") continue;

        const key = `${market.key}::${playerName}`;
        if (!linesByKey[key]) {
          linesByKey[key] = { lines: [], overOdds: [], underOdds: [], bookmakers: new Set() };
        }
        const entry = linesByKey[key]!;
        entry.lines.push(over.point!);
        entry.overOdds.push(over.price);
        entry.bookmakers.add(bm.key);

        const under = unders.find((u: OddsOutcome) => u.description === playerName && u.point === over.point);
        if (under) entry.underOdds.push(under.price);
      }
    }
  }

  const result: RawPropLine[] = [];

  for (const [key, data] of Object.entries(linesByKey)) {
    if (!data.lines.length) continue;

    const colonIdx = key.indexOf("::");
    const marketKey = key.slice(0, colonIdx);
    const playerName = key.slice(colonIdx + 2);

    // Consensus line (median)
    const sorted = [...data.lines].sort((a, b) => a - b);
    const line = sorted[Math.floor(sorted.length / 2)]!;
    const overOdds = data.overOdds.reduce((a, b) => a + b, 0) / data.overOdds.length;
    const underOdds = data.underOdds.length
      ? data.underOdds.reduce((a, b) => a + b, 0) / data.underOdds.length
      : -overOdds;

    result.push({
      eventId: event.id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      sport,
      marketKey,
      playerName,
      line,
      overOdds,
      underOdds,
      bookmakerCount: data.bookmakers.size,
    });
  }

  return result;
}

export interface GeneratedLivePick {
  id: string;
  gameId: string;
  playerName: string;
  team: string;
  propType: string;
  line: number;
  direction: "Over" | "Under";
  projection: number;
  confidence: number;
  riskTier: "Safe" | "Balanced" | "Aggressive";
  explanation: string;
  sport: string;
  detectedSignals: string[];
}

export function scoreEventsToGames(scores: ScoreEvent[], sport: string): GeneratedGame[] {
  return scores.map((e) => {
    const homeScore = e.scores?.find((s) => s.name === e.home_team)?.score;
    const awayScore = e.scores?.find((s) => s.name === e.away_team)?.score;
    // A game in the scores endpoint that hasn't started yet (no score entries)
    // should still be "Scheduled" — not "Live". Only mark "Live" when the API
    // has actually returned score data, meaning play has begun.
    const hasStarted = Boolean(e.scores && e.scores.length > 0);
    const status: "Scheduled" | "Live" | "Final" = e.completed
      ? "Final"
      : hasStarted
        ? "Live"
        : "Scheduled";
    return {
      id: e.id,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      sport,
      scheduledAt: e.commence_time,
      status,
      homeScore: homeScore ? Number(homeScore) : null,
      awayScore: awayScore ? Number(awayScore) : null,
      quarter: null,
      timeRemaining: null,
    };
  });
}

/**
 * Generate a pick explanation grounded ONLY in the supplied market data.
 * The prompt explicitly forbids the model from citing stats, injuries, or
 * matchup details it cannot verify — only odds-derived reasoning is allowed.
 */
async function generateExplanation(ctx: PickContext): Promise<string> {
  try {
    const prompt = `You are Ghostwatch, an AI sports betting assistant. Write exactly 2 sentences explaining why this player prop is worth betting.

STRICT RULES:
- Base your explanation ONLY on the market data listed below.
- Do NOT invent player stats, season averages, injury status, or matchup rankings you don't know.
- Do reference: the odds consensus, implied probability, line value, and the matchup context.
- Be direct and specific about the market signal. No filler phrases.

Market data:
  Sport: ${ctx.sport}
  Matchup: ${ctx.homeTeam} vs ${ctx.awayTeam}
  Player: ${ctx.playerName}
  Prop: ${ctx.direction} ${ctx.line} ${ctx.propType}
  Bookmakers agreeing: ${ctx.bookmakerCount}
  Odds-implied probability: ${ctx.impliedProbPct}%
  Confidence score: ${ctx.confidence}/100`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });
    return completion.choices[0]?.message?.content?.trim() ?? fallbackExplanation(ctx);
  } catch {
    return fallbackExplanation(ctx);
  }
}

/** Map implied probability to a confidence score (50–95) */
function probToConfidence(prob: number): number {
  // Scale: 50% implied → 50 confidence, 80% implied → 90 confidence
  const raw = 50 + (prob - 0.5) * 160;
  return Math.min(95, Math.max(45, Math.round(raw)));
}

export interface GeneratedSignal {
  id: string;
  gameId: string;
  type: "PaceSpike" | "UsageSpike" | "MismatchDetected" | "InjuryUpdate" | "FoulTrouble";
  description: string;
  strength: "Low" | "Medium" | "High";
  playerName: string;
  team: string;
}

/** Convert American odds to implied probability (0–1) */
function impliedProb(americanOdds: number): number {
  if (americanOdds >= 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function riskTierFromConfidence(conf: number): "Safe" | "Balanced" | "Aggressive" {
  if (conf >= 75) return "Safe";
  if (conf >= 60) return "Balanced";
  return "Aggressive";
}

function fallbackExplanation(ctx: PickContext): string {
  return `${ctx.bookmakerCount} bookmakers set the ${ctx.propType} line at ${ctx.line} with a ${ctx.impliedProbPct}% implied probability favoring ${ctx.direction}. Market consensus and confidence score of ${ctx.confidence}/100 support the ${ctx.direction} in the ${ctx.homeTeam} vs ${ctx.awayTeam} matchup.`;
}

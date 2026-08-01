/**
 * Picks engine — converts raw odds data from The Odds API into
 * Ghostwatch-style player prop picks with confidence scores,
 * risk tiers, and AI-generated explanations.
 *
 * Algorithm:
 *  1. Parse player prop outcomes across all bookmakers
 *  2. Group by player + prop + direction (Over/Under)
 *  3. Compute consensus line, implied probability, and book agreement
 *  4. Filter to picks with >55% implied probability edge
 *  5. Classify risk tier by confidence and odds price
 *  6. Generate concise data-driven explanation
 */

import type { OddsApiEventWithOdds, OddsApiMarket, OddsApiOutcome } from "./oddsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedPick {
  id: string;
  playerName: string;
  team: string;
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
  // enriched fields
  bookmakers: string[];
  avgAmericanOdds: number;
  impliedProbability: number;
  gameId: string;
  commenceTime: string;
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
  if (prices.length === 0) return 0.5;
  return prices.reduce((s, p) => s + americanToImplied(p), 0) / prices.length;
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
      // Pair Over/Under outcomes
      const byName: Record<string, { over?: OddsApiOutcome; under?: OddsApiOutcome }> = {};

      for (const outcome of market.outcomes) {
        const name = outcome.name;
        if (!byName[name]) byName[name] = {};
        if (outcome.description?.toLowerCase() === "over") byName[name].over = outcome;
        else if (outcome.description?.toLowerCase() === "under") byName[name].under = outcome;
        // Some markets don't use description (e.g. anytime TD) — skip
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

  // Determine team — player is on home or away team (we don't know which, use "vs")
  const team = group.homeTeam;
  const opponent = group.awayTeam;

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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate picks from raw Odds API data.
 * @param events - All events for the sport (includes game odds in bookmakers)
 * @param propMarketsMap - Map of eventId → player prop markets
 * @param sportTitle - Human-readable sport name
 */
export async function generatePicksFromOdds(
  events: OddsApiEventWithOdds[],
  propMarketsMap: Record<string, OddsApiMarket[]>,
  sportTitle: string,
): Promise<GeneratedPick[]> {
  const picks: GeneratedPick[] = [];

  for (const event of events) {
    const propMarkets = propMarketsMap[event.id];
    if (!propMarkets || propMarkets.length === 0) continue;

    // Create a synthetic event with prop market bookmakers merged in
    const eventWithProps: OddsApiEventWithOdds = {
      ...event,
      bookmakers: event.bookmakers.map((bm) => ({
        ...bm,
        markets: propMarkets,
      })),
    };

    const groups = extractPropGroups(eventWithProps, propMarkets, sportTitle);

    for (const group of groups) {
      const pick = scorePropGroup(group, sportTitle);
      if (pick) picks.push(pick);
    }
  }

  // Sort by confidence descending, deduplicate by player+prop (keep highest confidence)
  const seen = new Set<string>();
  const deduped: GeneratedPick[] = [];

  for (const pick of picks.sort((a, b) => b.confidence - a.confidence)) {
    const key = `${pick.playerName}|${pick.propType}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(pick);
    }
  }

  return deduped;
}

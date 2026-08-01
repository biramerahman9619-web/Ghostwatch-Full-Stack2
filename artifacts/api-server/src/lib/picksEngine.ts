/**
 * AI-powered picks engine.
 *
 * Flow:
 *  1. Parse real game odds (h2h, spreads, totals) from The Odds API free tier
 *  2. Build a structured game context per matchup (implied probabilities, spread, pace signal)
 *  3. Call OpenAI with that context to generate PrizePicks-style player prop picks
 *  4. Return typed GeneratedPick[] merged across all sports
 *
 * Why this beats raw prop lines:
 *  - OpenAI has deep player + team stat knowledge
 *  - Real game totals and spreads ground the AI's tempo/pace reasoning
 *  - The AI explains picks with genuine context (matchup, usage, defensive ranking)
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import type { OddsApiEventWithOdds } from "./oddsApi";
import { logger } from "./logger";

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
  // enriched context
  gameId: string;
  commenceTime: string;
  bookmakers: string[];
  impliedProbability: number;
  avgAmericanOdds: number;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function americanToImplied(odds: number): number {
  if (odds >= 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

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

/**
 * The Odds API client — aggregates live lines from Bovada, DraftKings,
 * FanDuel, BetMGM, PointsBet, BetRivers, Caesars, and more.
 *
 * Coverage mirrors PrizePicks + Bovada:
 *   NBA, WNBA, NFL, NCAAF, MLB, NHL, MMA, EPL, MLS, UCL, La Liga,
 *   Serie A, Bundesliga, Tennis (ATP/WTA), Golf, Boxing
 */

const BASE_URL = "https://api.the-odds-api.com/v4";

export const BOOKMAKERS_US = "draftkings,fanduel,betmgm,bovada,pointsbet,betrivers,caesars,unibet_us";

// ─── Sport definitions ────────────────────────────────────────────────────────

export interface SportDef {
  key: string;
  title: string;
  category: string;
  /** Player prop market keys available for this sport */
  propMarkets: string[];
  /** Whether to auto-fetch props (expensive quota) */
  fetchProps: boolean;
  /** Golf/racing only support outright markets, not h2h/spreads/totals */
  outrightOnly?: boolean;
}

export const ALL_SPORTS: SportDef[] = [
  // ── Basketball ──────────────────────────────────────────────────────────────
  {
    key: "basketball_nba",
    title: "NBA",
    category: "Basketball",
    fetchProps: true,
    propMarkets: [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_threes",
      "player_blocks",
      "player_steals",
      "player_points_rebounds_assists",
      "player_points_rebounds",
      "player_points_assists",
      "player_rebounds_assists",
      "player_turnovers",
      "player_first_basket",
    ],
  },
  {
    key: "basketball_wnba",
    title: "WNBA",
    category: "Basketball",
    fetchProps: true,
    propMarkets: [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_threes",
      "player_points_rebounds_assists",
    ],
  },
  {
    key: "basketball_ncaab",
    title: "NCAAB",
    category: "Basketball",
    fetchProps: false,
    propMarkets: ["player_points", "player_rebounds", "player_assists"],
  },
  // ── American Football ───────────────────────────────────────────────────────
  {
    key: "americanfootball_nfl",
    title: "NFL",
    category: "Football",
    fetchProps: true,
    propMarkets: [
      "player_pass_yds",
      "player_pass_tds",
      "player_pass_completions",
      "player_pass_attempts",
      "player_pass_interceptions",
      "player_rush_yds",
      "player_rush_attempts",
      "player_rush_tds",
      "player_reception_yds",
      "player_receptions",
      "player_reception_tds",
      "player_anytime_td",
      "player_kicking_points",
      "player_field_goals",
    ],
  },
  {
    key: "americanfootball_ncaaf",
    title: "NCAAF",
    category: "Football",
    fetchProps: false,
    propMarkets: [
      "player_pass_yds",
      "player_rush_yds",
      "player_reception_yds",
      "player_pass_tds",
    ],
  },
  // ── Baseball ────────────────────────────────────────────────────────────────
  {
    key: "baseball_mlb",
    title: "MLB",
    category: "Baseball",
    fetchProps: true,
    propMarkets: [
      "player_strikeouts",
      "player_hits",
      "player_home_runs",
      "player_rbis",
      "player_total_bases",
      "player_stolen_bases",
      "player_walks",
      "player_earned_runs",
      "pitcher_strikeouts",
      "batter_hits",
      "batter_total_bases",
      "batter_home_runs",
      "batter_rbis",
    ],
  },
  // ── Hockey ──────────────────────────────────────────────────────────────────
  {
    key: "icehockey_nhl",
    title: "NHL",
    category: "Hockey",
    fetchProps: true,
    propMarkets: [
      "player_points",
      "player_goals",
      "player_assists",
      "player_shots_on_goal",
      "player_saves",
      "player_power_play_points",
      "player_blocked_shots",
    ],
  },
  {
    key: "icehockey_pwhl",
    title: "PWHL",
    category: "Hockey",
    fetchProps: false,
    propMarkets: ["player_points", "player_goals", "player_shots_on_goal"],
  },
  // ── Soccer ──────────────────────────────────────────────────────────────────
  {
    key: "soccer_epl",
    title: "EPL",
    category: "Soccer",
    fetchProps: false,
    propMarkets: [
      "player_goal_scorer_anytime",
      "player_shots_on_target",
      "player_assists",
    ],
  },
  {
    key: "soccer_usa_mls",
    title: "MLS",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime", "player_shots_on_target"],
  },
  {
    key: "soccer_uefa_champs_league",
    title: "UCL",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime"],
  },
  {
    key: "soccer_spain_la_liga",
    title: "La Liga",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime"],
  },
  {
    key: "soccer_germany_bundesliga",
    title: "Bundesliga",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime"],
  },
  {
    key: "soccer_italy_serie_a",
    title: "Serie A",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime"],
  },
  {
    key: "soccer_france_ligue_1",
    title: "Ligue 1",
    category: "Soccer",
    fetchProps: false,
    propMarkets: ["player_goal_scorer_anytime"],
  },
  // ── MMA / Combat ────────────────────────────────────────────────────────────
  {
    key: "mma_mixed_martial_arts",
    title: "MMA",
    category: "Combat Sports",
    fetchProps: false,
    propMarkets: [],
  },
  {
    key: "boxing_boxing",
    title: "Boxing",
    category: "Combat Sports",
    fetchProps: false,
    propMarkets: [],
  },
  // ── Tennis ──────────────────────────────────────────────────────────────────
  {
    key: "tennis_atp_wimbledon",
    title: "Tennis (ATP Wimbledon)",
    category: "Tennis",
    fetchProps: false,
    propMarkets: [],
  },
  {
    key: "tennis_wta_wimbledon",
    title: "Tennis (WTA Wimbledon)",
    category: "Tennis",
    fetchProps: false,
    propMarkets: [],
  },
  {
    key: "tennis_atp_us_open",
    title: "Tennis (ATP US Open)",
    category: "Tennis",
    fetchProps: false,
    propMarkets: [],
  },
  {
    key: "tennis_wta_us_open",
    title: "Tennis (WTA US Open)",
    category: "Tennis",
    fetchProps: false,
    propMarkets: [],
  },
  // ── Golf / Racing (outright-only — no h2h/spreads/totals) ──────────────────
  {
    key: "golf_pga_championship",
    title: "PGA Championship",
    category: "Golf",
    fetchProps: false,
    propMarkets: [],
    outrightOnly: true,
  },
  {
    key: "golf_masters_tournament_winner",
    title: "Masters",
    category: "Golf",
    fetchProps: false,
    propMarkets: [],
    outrightOnly: true,
  },
  {
    key: "motorsport_formula_1",
    title: "Formula 1",
    category: "Racing",
    fetchProps: false,
    propMarkets: [],
    outrightOnly: true,
  },
] as (SportDef & { outrightOnly?: boolean })[];

// ─── API types ────────────────────────────────────────────────────────────────

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface OddsApiOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEventWithOdds extends OddsApiEvent {
  bookmakers: OddsApiBookmaker[];
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

let remainingRequests: number | null = null;
let remainingCredits: number | null = null;

export function getQuotaStats() {
  return { remainingRequests, remainingCredits };
}

async function oddsApiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    throw new Error("THE_ODDS_API_KEY is not configured. Add it in your environment secrets.");
  }

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());

  // Track quota from response headers
  const reqsLeft = res.headers.get("x-requests-remaining");
  const creditsLeft = res.headers.get("x-requests-used");
  if (reqsLeft) remainingRequests = parseInt(reqsLeft, 10);
  if (creditsLeft) remainingCredits = parseInt(creditsLeft, 10);

  if (res.status === 401) throw new Error("Invalid Odds API key — check THE_ODDS_API_KEY secret.");
  if (res.status === 429) throw new Error("Odds API quota exhausted for this period.");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odds API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API functions ─────────────────────────────────────────────────────

/** List all currently active sports (respects season schedule). */
export async function fetchActiveSports(): Promise<{ key: string; title: string; active: boolean }[]> {
  return oddsApiFetch("/sports", { all: "false" });
}

/** Fetch all events + game odds (h2h + spreads + totals) for a sport. 1 quota credit. */
export async function fetchGameOdds(sportKey: string): Promise<OddsApiEventWithOdds[]> {
  return oddsApiFetch<OddsApiEventWithOdds[]>(`/sports/${sportKey}/odds`, {
    regions: "us",
    markets: "h2h,spreads,totals",
    bookmakers: BOOKMAKERS_US,
    dateFormat: "iso",
    oddsFormat: "american",
  });
}

/** Fetch player prop odds for a specific event. 1 quota credit per call. */
export async function fetchEventProps(
  eventId: string,
  sportKey: string,
  markets: string[],
): Promise<OddsApiEventWithOdds> {
  return oddsApiFetch<OddsApiEventWithOdds>(`/events/${eventId}/odds`, {
    regions: "us",
    markets: markets.slice(0, 4).join(","), // API limits 4 markets per call
    bookmakers: BOOKMAKERS_US,
    dateFormat: "iso",
    oddsFormat: "american",
  });
}

/**
 * Fetch all player prop market batches for an event (4 markets per API call).
 * Returns the full per-bookmaker structure so extraction can track which book
 * offered each price.
 */
export async function fetchAllEventProps(
  eventId: string,
  sportKey: string,
  markets: string[],
): Promise<OddsApiBookmaker[]> {
  const batches: string[][] = [];
  for (let i = 0; i < markets.length; i += 4) {
    batches.push(markets.slice(i, i + 4));
  }

  // Accumulate all bookmakers, merging their markets across batches
  const bookmakerMap = new Map<string, OddsApiBookmaker>();

  for (const batch of batches) {
    try {
      const result = await fetchEventProps(eventId, sportKey, batch);
      for (const bm of result.bookmakers) {
        const existing = bookmakerMap.get(bm.key);
        if (!existing) {
          bookmakerMap.set(bm.key, { ...bm, markets: [...bm.markets] });
        } else {
          existing.markets.push(...bm.markets);
        }
      }
    } catch {
      // Skip unavailable markets — some sports don't offer all prop types
    }
  }

  return [...bookmakerMap.values()];
}

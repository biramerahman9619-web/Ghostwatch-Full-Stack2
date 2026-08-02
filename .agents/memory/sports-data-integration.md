---
name: Sports data integration
description: Durable constraints for the Odds API + OpenAI pick engine
---

# Sports Data Integration — Durable Constraints

## Team attribution
The Odds API player-prop markets do NOT reveal which team a player is on. Never assign players to home/away. Use neutral matchup context (`"HomeTeam vs. AwayTeam"`) in both `team` and `opponent` pick fields.

**Why:** Falsely attributing ~50% of players to the wrong team produces misleading pick cards.

## Provenance: empty API response ≠ fallback to mock
When ODDS_API_KEY is active, a successful API call returning zero games/props is still a valid real-data response (off-season, no games today). Must clear all collections and set `usingRealData = true`. Only retain prior state on identifiable request failures (caught exceptions).

**Why:** Silently serving mock picks when the API is active—but returned nothing—was rejected as a provenance violation.

## Live picks and signals
The Odds API has no live play-by-play or in-game props endpoint. Once real-data mode is active, `livePicks` and `signals` must be cleared (`[]` / `{}`). Do not retain mock live intel alongside real game data.

## Explanation grounding
OpenAI pick explanations must be strictly grounded in available market data (matchup, line, odds-implied probability, bookmaker count). Never ask the model to cite stats or injury reports it cannot verify.

## Status endpoint
`GET /api/ghostwatch/status` exposes `{ lastRefreshedAt, usingRealData }` for client-side provenance display.

# Ghostwatch

An AI-powered sports betting assistant with four modules: a picks dashboard, live in-game AI, an automation butler, and social/news intel.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ghostwatch run dev` — run the frontend (port 23117)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: React + Vite, Wouter routing, TanStack React Query
- DB: PostgreSQL + Drizzle ORM (user_settings table)
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod validation schemas (do not edit)
- `lib/db/src/schema/userSettings.ts` — user_settings table (the only persisted entity)
- `artifacts/api-server/src/routes/` — route handlers by domain
- `artifacts/api-server/src/lib/mockData.ts` — all mock sports/picks/social data (swap in real APIs here)
- `artifacts/ghostwatch/src/` — React frontend

## Architecture decisions

- All sports data (picks, games, live scores, signals, social alerts) is mocked in `mockData.ts`. The file is structured so each data source can be replaced with a real API call independently.
- User settings are the only DB-persisted entity — everything else is ephemeral/mock.
- OpenAPI integer fields use `type: number` (not `type: integer`) because Orval generates `zod.int()` for integer which doesn't exist in Zod v3. Use `number` throughout and validate as needed in route handlers.

## Product

- **Ghostwatch (/)** — recommended player prop picks with risk tier (Safe/Balanced/Aggressive), confidence scores, AI projections vs. lines, and filterable by sport and tier
- **Ghost Express (/ghost-express)** — live in-game signals (pace spikes, usage spikes, mismatches) and real-time updated live picks
- **Ghostspere (/ghostspere)** — auto-built ticket combos grouped by risk tier, email dispatch via `POST /api/ghostspere/send-email`, and user settings
- **Ghostobservation (/ghostobservation)** — social alerts per player (party risk, fatigue, injury) and team pulse cards

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ Yes | — | Postgres connection string for user_settings table |
| `ODDS_API_KEY` | No | — | [The Odds API](https://the-odds-api.com/) key — enables real game slates, scores, and player prop lines. When absent, app serves mock data. |
| `PICKS_REFRESH_INTERVAL_MINUTES` | No | `15` | How often the scheduler refreshes picks and games from The Odds API |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Auto-set | — | Replit AI Integrations proxy base URL for OpenAI (auto-provisioned) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Auto-set | — | Replit AI Integrations OpenAI API key (auto-provisioned) |

## Gotchas

- After any `lib/api-spec/openapi.yaml` change, run `pnpm --filter @workspace/api-spec run codegen` before writing backend routes (Zod schema names vary by parameter location)
- Use `type: number` in the OpenAPI spec for integer fields — Orval + Zod v3 incompatibility with `type: integer`
- Mock data lives in `artifacts/api-server/src/lib/mockData.ts` — real API integrations go there

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

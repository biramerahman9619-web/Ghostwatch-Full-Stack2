---
name: Ghostwatch architecture
description: Key decisions, constraints, and integration points for the Ghostwatch sports betting AI app.
---

## Auth
- Uses Replit Auth (not Clerk) via `@workspace/replit-auth-web` and `openid-client` on the server.
- `useAuth()` from `@workspace/replit-auth-web` is the client-side auth hook. Do NOT use the generated API hook for auth state.
- `<meta name="base-path" content="/">` in index.html is required for auth redirect logic.
- Auth middleware: `artifacts/api-server/src/middlewares/authMiddleware.ts`

## OpenAPI / Codegen constraint
- Use `type: number` (NOT `type: integer`) everywhere in openapi.yaml — Orval + Zod v3 incompatibility with `zod.int()`.
- Do NOT use `format: uri` — generates `zod.url()` which doesn't exist in Zod v3.

## Ghostphere AI (OpenAI)
- Streaming SSE endpoint: `POST /api/openai/conversations/{id}/messages`
- System prompt is "Ghostphere" persona — elite sports betting intelligence, defined in `artifacts/api-server/src/routes/openai.ts`.
- Use raw `fetch` + `ReadableStream` for streaming — Orval cannot generate typed hooks for SSE.
- Model: `gpt-5.6-terra` (Replit AI proxy model name).

## Libs
- `@workspace/replit-auth-web` — browser auth hook; tsconfig needs `jsx: react-jsx`, no `vite/client` types (lib isn't a Vite artifact).
- `@workspace/integrations-openai-ai-react` — needs `@types/react` devDependency and `jsx: react-jsx` in tsconfig.
- `@workspace/integrations-openai-ai-server` — wraps OpenAI client with Replit AI proxy secrets.

## Mock data
- All picks, games, signals, social data in `artifacts/api-server/src/lib/mockData.ts` — swap-in point for real sports APIs.
- Task #1 in progress: connect real sports data (The Odds API).

## Design
- Dark Bloomberg terminal aesthetic, cyan (#00d4ff) accents, risk-tier color coding.
- Cover page: "GHOSTWATCH — The war room for serious sports bettors" with ghost icon, "CLASSIFIED ACCESS" badge, "Powered by Ghostroom" link.
- Ghostphere AI panel: right-side slide-out with conversation list + streaming chat.

**Why:** Multiple non-obvious constraints discovered during implementation — documenting to prevent rework.

# Print Sahyogi

A web tool that lets users upload, unlock (password-protected), auto-crop, and print Aadhaar card PDFs in a print-ready A4 layout — entirely client-side with zero data stored. Also includes a passport photo maker with background removal and face-aware cropping.

## Run & Operate

- `pnpm --filter @workspace/print-sahyogi run dev` — run the frontend (managed workflow: `artifacts/print-sahyogi: web`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (managed workflow: `artifacts/api-server: API Server`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase auth
- Required env: `REMOVEBG_API_KEY` — remove.bg background removal (via `/api/removebg` proxy)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, Framer Motion, shadcn/ui, wouter (routing)
- Auth: Supabase
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/print-sahyogi/` — React + Vite frontend, preview path `/`
- `artifacts/api-server/` — Express API server, preview path `/api`
- `lib/db/` — Drizzle schema + migrations
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/` — generated React Query hooks from OpenAPI spec

## Key pages

- `/` — Home
- `/demo-passport-size-maker` — Passport photo maker (upload → remove bg → crop → +/- rows → download A4 PDF)
- `/demopdf` — Aadhaar PDF tool (demo)
- `/aadhaar/crop` — Protected Aadhaar crop tool
- `/voter-id-card/crop` — Protected Voter ID crop tool

## Architecture decisions

- Passport photo maker is entirely client-side (no server storage) — remove.bg call proxied through `/api/removebg` to keep API key server-side
- Supabase used for auth only; DB schema lives in Drizzle (PostgreSQL)
- Vercel `outputDirectory` resolves relative to package CWD → output to `build/` (not gitignored) within `artifacts/print-sahyogi/`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any code/package/toolchain changes, restart the relevant managed workflow (`artifacts/print-sahyogi: web` for frontend)
- `pnpm install` must be run before starting workflows in a fresh environment

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

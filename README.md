# EZONE / Print Sahyogi

A web tool for cropping and printing Aadhaar (and Voter ID) card PDFs in a print-ready A4 layout, plus a passport photo maker with background removal and face-aware cropping. Aadhaar/Voter ID processing is entirely client-side — no files are uploaded or stored on a server.

Live: https://ezoneonline.vercel.app/

## Features

- **Aadhaar / Voter ID PDF cropper** — upload a password-protected PDF, unlock it, auto-crop front/back, and lay it out on a printable A4 sheet
- **Passport photo maker** — upload a photo, remove the background (via remove.bg), face-aware crop to standard photo size, arrange multiple copies on an A4 sheet, and download as PDF

## Stack

- pnpm workspaces monorepo, Node.js 22+, TypeScript
- Frontend: React + Vite, Tailwind CSS, Framer Motion, shadcn/ui, wouter (routing)
- Auth: username + password (SHA-256) against Postgres — see `lib/db`
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (generates React Query hooks from the OpenAPI spec)

## Project structure

```
artifacts/print-sahyogi/   React + Vite frontend
artifacts/api-server/      Express API server
lib/db/                    Drizzle schema + migrations
lib/api-spec/openapi.yaml  OpenAPI spec (source of truth for API contracts)
lib/api-client-react/      Generated React Query hooks
api/removebg.js            Vercel serverless function proxying remove.bg (keeps API key server-side)
scripts/build-vercel.mjs   Vercel Build Output API v3 build script (see Deployment below)
```

## Getting started

```bash
pnpm install
pnpm --filter @workspace/print-sahyogi run dev   # frontend
pnpm --filter @workspace/api-server run dev       # API server
```

### Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Session signing secret |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase (used for `registration_codes` table only) |
| `REMOVEBG_API_KEY` | remove.bg background removal, used by `/api/removebg` |

## Useful scripts

- `pnpm run typecheck` — typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Deployment (Vercel)

This is a pnpm monorepo, and Vercel's `outputDirectory` resolution is unreliable across monorepo package boundaries. The build therefore uses the **Vercel Build Output API v3** instead: `vercel.json`'s `buildCommand` runs `node scripts/build-vercel.mjs`, which builds the frontend with Vite and writes the result directly to `.vercel/output/` (static assets + the `/api/removebg` serverless function + routing config). Vercel uses that directory unconditionally, sidestepping `outputDirectory` entirely.

Notes for maintaining this project on Vercel:

- Make sure `REMOVEBG_API_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` are set in the Vercel project's Environment Variables.
- Confirm the Vercel project's **Production Branch** (Project Settings → Git) matches the branch you intend to deploy from.
- If deploys are blocked with "commit author does not have contributing access," disable the collaborator-access restriction under Project Settings → Git (Deployment Protection), since commits are authored by an automated identity.

## License

MIT

---
name: Vercel monorepo build
description: How to reliably build and deploy the pnpm monorepo to Vercel without outputDirectory path ambiguity.
---

# Vercel monorepo build

## The Rule
Use the **Vercel Build Output API** (`scripts/build-vercel.mjs`) — do NOT rely on `outputDirectory` in `vercel.json` for this repo.

**Why:** In this pnpm monorepo, the `buildCommand` is `pnpm --filter @workspace/print-sahyogi run build`. Vercel CLI resolved `outputDirectory` from an unpredictable base (sometimes repo root, sometimes the package CWD `/vercel/path0/artifacts/print-sahyogi`). Every combination of `"build"`, `"artifacts/print-sahyogi/build"`, etc. failed with "No Output Directory named 'build' found" — even when the build clearly wrote files to the expected path.

**Fix:** `scripts/build-vercel.mjs` runs the Vite build, then produces `.vercel/output/` (Build Output API v3). Vercel uses `.vercel/output/config.json` unconditionally when present, completely bypassing `outputDirectory` resolution and project-settings overrides.

## How to Apply
- `vercel.json` `buildCommand` = `node scripts/build-vercel.mjs`
- No `outputDirectory` needed in `vercel.json`
- `scripts/build-vercel.mjs` handles: Vite build → copy to `.vercel/output/static/` → `/api/removebg` serverless function → routes config
- Vite `outDir` on Vercel = package-local `build/` (NOT `../../build`); the script copies it

## `.vercel/output/` structure
```
.vercel/output/
  config.json          — version: 3, routes (API + asset cache headers + SPA fallback)
  static/              — Vite build output
  functions/
    api/
      removebg.func/
        index.js       — copied from api/removebg.js
        .vc-config.json — { runtime: "nodejs20.x", handler: "index.js", launcherType: "Nodejs" }
```

## Gotchas
- There are TWO `vercel.json` files: repo root and `artifacts/print-sahyogi/`. The inner one only has rewrites (redundant now — routes live in `config.json`). Do not add `outputDirectory` to either.
- `.vercel/` is gitignored — it's created fresh by the build script on Vercel.
- The build script runs without `VERCEL=1` so Vite uses its local `build/` path (not `../../build`). The script then copies from `artifacts/print-sahyogi/build/` to `.vercel/output/static/`.

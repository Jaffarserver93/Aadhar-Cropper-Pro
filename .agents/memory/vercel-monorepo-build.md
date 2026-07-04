---
name: Vercel monorepo build quirks
description: How Vercel resolves outputDirectory and what directory names to avoid in pnpm workspaces
---

## Rules

1. `outputDirectory` in vercel.json is resolved relative to the **package CWD** (where pnpm filter runs the build), NOT the monorepo root.
   - If build runs from `artifacts/print-sahyogi/`, then `outputDirectory: "build"` means `artifacts/print-sahyogi/build`.
   - Setting `outputDirectory: "artifacts/print-sahyogi/build"` creates a doubled path and fails.

2. `dist` is gitignored globally in this repo. Vercel skips gitignored directories when scanning for build output, even if they exist on disk after the build. Use `build` instead.

3. When `VERCEL=1` env var is set, vite.config.ts outputs to `build/` inside the artifact dir. Locally it outputs to `dist/`.

**Why:** Multiple failed Vercel deployments (6+ attempts) revealed these two independent issues. Each alone would cause "No Output Directory found" even after a successful build.

**How to apply:** For any new artifact deployed to Vercel from this monorepo, use `outDir: "build"` on Vercel and `outputDirectory: "build"` in vercel.json placed inside the artifact dir (not the repo root). Set Root Directory to the artifact dir in the Vercel dashboard.

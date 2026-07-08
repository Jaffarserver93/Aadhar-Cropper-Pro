/**
 * Vercel Build Output API v3 script.
 *
 * When .vercel/output/ is produced by the build, Vercel CLI uses it
 * unconditionally — ignoring outputDirectory, project settings, and all
 * monorepo path-resolution ambiguity. This is the definitive fix.
 *
 * Spec: https://vercel.com/docs/build-output-api/v3
 */

import { execSync } from 'child_process';
import { mkdirSync, cpSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // repo root
const PACKAGE_DIR = path.join(ROOT, 'artifacts', 'print-sahyogi');
const VITE_OUT = path.join(PACKAGE_DIR, 'build'); // vite outDir (non-Vercel path)
const VERCEL_OUT = path.join(ROOT, '.vercel', 'output');

// ── 1. Run Vite build ──────────────────────────────────────────────────────
// vite.config.ts always outputs to the package-local `build/` dir
// unconditionally, so this works the same regardless of env vars.
console.log('\n▶ Running Vite build…');
execSync('pnpm --filter @workspace/print-sahyogi run build', {
  cwd: ROOT,
  stdio: 'inherit',
});

if (!existsSync(path.join(VITE_OUT, 'index.html'))) {
  console.error(`✗ Vite output not found at ${VITE_OUT}`);
  process.exit(1);
}

// ── 2. Create .vercel/output structure ────────────────────────────────────
// NOTE: we deliberately do NOT build the /api/removebg function ourselves.
// Vercel always auto-detects and builds any file under the repo-root
// `api/` directory as a Serverless Function (zero-config), independently
// of this custom buildCommand / Build Output API static output. Manually
// placing our own function under .vercel/output/functions previously
// collided with that auto-built one and produced 404s. We only emit the
// static output + routing config here; Vercel merges in the api/ function
// automatically at deploy time.
console.log('\n▶ Creating .vercel/output…');
if (existsSync(VERCEL_OUT)) rmSync(VERCEL_OUT, { recursive: true });
mkdirSync(path.join(VERCEL_OUT, 'static'), { recursive: true });

// ── 3. Copy static assets ─────────────────────────────────────────────────
cpSync(VITE_OUT, path.join(VERCEL_OUT, 'static'), { recursive: true });
console.log(`  ✓ Copied static assets from ${path.relative(ROOT, VITE_OUT)}`);

// ── 4. Write config.json (routes + headers) ───────────────────────────────
writeFileSync(path.join(VERCEL_OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    // Cache static assets (hashed filenames)
    {
      src: '^/assets/(.+)$',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      continue: true,
    },
    // Check the filesystem (static files + auto-built functions, e.g.
    // /api/removebg from api/removebg.js) before falling back to the SPA.
    // Without this, custom `routes` fully replace default routing and
    // /api/* requests never reach the function — they just 404.
    { handle: 'filesystem' },
    // SPA fallback — everything except /api/* → index.html.
    { src: '^/((?!api/).*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log('  ✓ config.json with routes');

console.log('\n✅ .vercel/output ready\n');

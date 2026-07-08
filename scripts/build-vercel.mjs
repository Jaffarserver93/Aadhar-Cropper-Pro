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
// We build the /api/removebg function ourselves explicitly, rather than
// relying on Vercel's zero-config auto-detection of the repo-root `api/`
// directory — that auto-detection did not reliably merge with our custom
// Build Output API static output and produced 404s.
console.log('\n▶ Creating .vercel/output…');
if (existsSync(VERCEL_OUT)) rmSync(VERCEL_OUT, { recursive: true });
mkdirSync(path.join(VERCEL_OUT, 'static'), { recursive: true });
mkdirSync(path.join(VERCEL_OUT, 'functions', 'api', 'removebg.func'), { recursive: true });

// ── 3. Copy static assets ─────────────────────────────────────────────────
cpSync(VITE_OUT, path.join(VERCEL_OUT, 'static'), { recursive: true });
console.log(`  ✓ Copied static assets from ${path.relative(ROOT, VITE_OUT)}`);

// ── 4. Set up /api/removebg serverless function ───────────────────────────
// The handler source uses ESM (`export default`). Use `.mjs` so it's
// unambiguously loaded as an ES module by the Node runtime.
const funcDir = path.join(VERCEL_OUT, 'functions', 'api', 'removebg.func');
cpSync(path.join(ROOT, 'api', 'removebg.js'), path.join(funcDir, 'index.mjs'));
writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: true,
}));
console.log('  ✓ Serverless function: /api/removebg');

// ── 5. Write config.json (routes + headers) ───────────────────────────────
const routeApi = { src: '^/api/removebg$', dest: '/api/removebg' };
const routeAssets = {
  src: '^/assets/(.+)$',
  headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  continue: true,
};
const routeFilesystem = { handle: 'filesystem' };
const routeSpaFallback = { src: '^/((?!api/).*)$', dest: '/index.html' };

writeFileSync(
  path.join(VERCEL_OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [routeApi, routeAssets, routeFilesystem, routeSpaFallback],
    },
    null,
    2,
  ),
);
console.log('  ✓ config.json with routes');

console.log('\n✅ .vercel/output ready\n');

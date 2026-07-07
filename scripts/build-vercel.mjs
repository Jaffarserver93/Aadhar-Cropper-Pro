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
import { mkdirSync, cpSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // repo root
const PACKAGE_DIR = path.join(ROOT, 'artifacts', 'print-sahyogi');
const VITE_OUT = path.join(PACKAGE_DIR, 'build'); // vite outDir (non-Vercel path)
const VERCEL_OUT = path.join(ROOT, '.vercel', 'output');

// ── 1. Run Vite build ──────────────────────────────────────────────────────
// Run WITHOUT VERCEL=1 so vite outputs to the package-local `build/` dir,
// which is a clean known path we can reliably find and copy from.
console.log('\n▶ Running Vite build…');
execSync('pnpm --filter @workspace/print-sahyogi run build', {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VERCEL: '' }, // clear so vite uses local build/ path
});

if (!existsSync(path.join(VITE_OUT, 'index.html'))) {
  console.error(`✗ Vite output not found at ${VITE_OUT}`);
  process.exit(1);
}

// ── 2. Create .vercel/output structure ────────────────────────────────────
console.log('\n▶ Creating .vercel/output…');
if (existsSync(VERCEL_OUT)) rmSync(VERCEL_OUT, { recursive: true });
mkdirSync(path.join(VERCEL_OUT, 'static'), { recursive: true });
mkdirSync(path.join(VERCEL_OUT, 'functions', 'api', 'removebg.func'), { recursive: true });

// ── 3. Copy static assets ─────────────────────────────────────────────────
cpSync(VITE_OUT, path.join(VERCEL_OUT, 'static'), { recursive: true });
console.log(`  ✓ Copied static assets from ${path.relative(ROOT, VITE_OUT)}`);

// ── 4. Set up /api/removebg serverless function ───────────────────────────
const funcDir = path.join(VERCEL_OUT, 'functions', 'api', 'removebg.func');
cpSync(path.join(ROOT, 'api', 'removebg.js'), path.join(funcDir, 'index.js'));
writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.js',
  launcherType: 'Nodejs',
  shouldAddHelpers: true,
}));
console.log('  ✓ Serverless function: /api/removebg');

// ── 5. Write config.json (routes + headers) ───────────────────────────────
writeFileSync(path.join(VERCEL_OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    // API function
    { src: '^/api/removebg$', dest: '/api/removebg' },
    // Cache static assets (hashed filenames)
    {
      src: '^/assets/(.+)$',
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      continue: true,
    },
    // SPA fallback — everything else → index.html
    { src: '^/((?!api/).*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log('  ✓ config.json with routes');

console.log('\n✅ .vercel/output ready\n');

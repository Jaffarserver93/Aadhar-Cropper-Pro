import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const isReplit = Boolean(process.env.REPL_ID);
const isVercel = Boolean(process.env.VERCEL);

const port = Number(process.env.PORT) || 3000;
const basePath = process.env.BASE_PATH || '/';

// Vercel resolves outputDirectory relative to the package dir (artifacts/print-sahyogi/),
// not the monorepo root. Output to `build/` (not gitignored) within this package dir
// so vercel.json outputDirectory="build" resolves correctly.
// Locally / Replit: keep using `dist` inside the artifact dir.
const outDir = isVercel
  ? path.resolve(import.meta.dirname, 'build')
  : path.resolve(import.meta.dirname, 'dist');

export default defineConfig(async () => {
  const plugins = [react(), tailwindcss()];

  if (isReplit) {
    const { default: runtimeErrorOverlay } = await import(
      '@replit/vite-plugin-runtime-error-modal'
    );
    plugins.push(runtimeErrorOverlay());

    if (process.env.NODE_ENV !== 'production') {
      const { cartographer } = await import('@replit/vite-plugin-cartographer');
      plugins.push(
        cartographer({ root: path.resolve(import.meta.dirname, '..') }),
      );
      const { devBanner } = await import('@replit/vite-plugin-dev-banner');
      plugins.push(devBanner());
    }
  }

  return {
    base: basePath,
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir,
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: { strict: true },
      proxy: isReplit
        ? { '/api': { target: 'http://localhost:8080', changeOrigin: true } }
        : undefined,
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});

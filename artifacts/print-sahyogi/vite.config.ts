import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const isReplit = Boolean(process.env.REPL_ID);

const port = Number(process.env.PORT) || 3000;
const basePath = process.env.BASE_PATH || '/';

// Always output to the package-local `build/` dir, regardless of
// environment. The Vercel build script (scripts/build-vercel.mjs) copies
// this into .vercel/output/static/. Keeping this unconditional avoids any
// dependency on env vars (e.g. VERCEL) being set consistently across
// contexts.
const outDir = path.resolve(import.meta.dirname, 'build');

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
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});

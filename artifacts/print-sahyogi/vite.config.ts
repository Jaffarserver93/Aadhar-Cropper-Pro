import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Replit-specific plugins are only loaded when running inside a Repl.
const isReplit = Boolean(process.env.REPL_ID);

// On Vercel (and other CI/CD), PORT and BASE_PATH are not set.
// Fall back to sensible defaults so `vite build` doesn't throw.
const port = Number(process.env.PORT) || 3000;
const basePath = process.env.BASE_PATH || '/';

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
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: { strict: true },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});

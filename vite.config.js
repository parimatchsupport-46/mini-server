import { defineConfig } from 'vite';

/**
 * Dev-only: answer GET /api/health so the dashboard can tell (without a failed
 * request) that no EdgeOne Functions are running and it should use the mock
 * backend. The deployed build never sees this - the real Function responds.
 */
function previewHealthShim() {
  return {
    name: 'storage-server-preview-health',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/health', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              status: 'ok',
              runtime: 'preview',
              preview: true,
              kvBackend: 'localStorage',
              blobBackend: 'localStorage',
              initialised: true,
              time: new Date().toISOString(),
            },
          }),
        );
      });
    },
  };
}

/**
 * Vite config.
 *
 * `npm run dev`  -> serves the dashboard with mocked in-browser data (src/services/mock-backend.js).
 * `npm run build` -> static assets in /dist, deployable to EdgeOne Pages together with `functions/`.
 */
export default defineConfig({
  plugins: [previewHealthShim()],
  root: '.',
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandboxed preview is proxied through a dynamic *.e2b.app host.
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
});

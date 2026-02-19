import { defineConfig, type Plugin } from 'vite';
import { resolve, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const distDir = resolve(__dirname, '../dist');

function serveDistPlugin(): Plugin {
  return {
    name: 'serve-dist',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split('?')[0];
        const filePath = join(distDir, url);
        if (
          existsSync(filePath) &&
          (url.endsWith('.js') || url.endsWith('.wasm') || url.endsWith('.data'))
        ) {
          const content = readFileSync(filePath);
          if (url.endsWith('.js'))
            res.setHeader('Content-Type', 'application/javascript');
          else if (url.endsWith('.wasm'))
            res.setHeader('Content-Type', 'application/wasm');
          else res.setHeader('Content-Type', 'application/octet-stream');
          res.end(content);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [serveDistPlugin()],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist-demo'),
  },
});

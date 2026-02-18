import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Vite plugin that serves Vercel-style serverless functions from /api
 * during local development. Each file in api/ is loaded as a module
 * and its default export is called as an Express-compatible handler.
 */
function vercelApiPlugin(): Plugin {
  return {
    name: 'vercel-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }

        try {
          // Map URL to file path: /api/google-calendar/luma-events -> api/google-calendar/luma-events.ts
          const apiPath = req.url.split('?')[0]; // strip query string
          const filePath = path.resolve(process.cwd(), apiPath.slice(1) + '.ts');

          // Use Vite's ssrLoadModule to load the TS file with hot reloading
          const mod = await server.ssrLoadModule(filePath);
          if (!mod.default || typeof mod.default !== 'function') {
            return next();
          }

          // Parse JSON body for POST requests
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(chunk as Buffer);
            }
            const bodyStr = Buffer.concat(chunks).toString();
            (req as unknown as Record<string, unknown>).body = bodyStr ? JSON.parse(bodyStr) : {};
          }

          // Create a minimal Vercel-compatible response wrapper
          const vercelRes = {
            _statusCode: 200,
            _headers: {} as Record<string, string>,
            status(code: number) { this._statusCode = code; return this; },
            setHeader(key: string, value: string) { this._headers[key] = value; return this; },
            json(data: unknown) {
              res.writeHead(this._statusCode, { 'Content-Type': 'application/json', ...this._headers });
              res.end(JSON.stringify(data));
            },
          };

          await mod.default(req, vercelRes);
        } catch (err) {
          console.error('API handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiPlugin()],
})

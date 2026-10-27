import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * Serves the built SPA from one Node process (`npm run build && npm start`), falling back to
 * index.html for client routes. Must be mounted after the API so /api/* never reaches it.
 * Returns false when there is no build to serve (dev, where Vite serves the app).
 */
export function mountSpa(app: Hono, distDir: string): boolean {
  if (!existsSync(join(distDir, "index.html"))) return false;
  // serveStatic resolves `root` against the working directory.
  const root = relative(process.cwd(), distDir) || ".";
  app.get("*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
  return true;
}

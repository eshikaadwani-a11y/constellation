#!/usr/bin/env node
// A tiny static file server with zero dependencies.
//
// It serves the `public/` directory as the web root and exposes the compiled
// TypeScript output under `/dist`. Single-page routes fall back to the
// corresponding HTML entry point. This is intentionally minimal: Constellation
// runs entirely in the browser, so no application server is required.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Resolve a request URL to an absolute file path, guarding against traversal. */
function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  if (clean.startsWith("/dist/")) return join(root, clean);
  return join(root, "public", clean === "/" ? "index.html" : clean);
}

async function tryFile(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return tryFile(join(path, "index.html"));
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const urlPath = req.url ?? "/";
  let filePath = resolvePath(urlPath);
  let body = await tryFile(filePath);

  // SPA-style fallback: unknown extensionless routes serve the lab shell.
  if (body === null && extname(filePath) === "") {
    filePath = join(root, "public", "app.html");
    body = await tryFile(filePath);
  }

  if (body === null) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`Constellation is running at http://${HOST}:${PORT}`);
});

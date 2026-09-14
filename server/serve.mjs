// Tiny static server for the built application. No dependencies, no network
// access beyond 127.0.0.1. Serves dist/ with an index.html fallback so the app's
// hash routes and the service worker both work.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = Number(process.env.TC_PORT || process.argv[2] || 47800);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build found at ${root}. Run "npm run build" first (start.cmd does this for you).`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) {
      file = join(root, 'index.html');
      s = await stat(file);
    }
    const ext = extname(file).toLowerCase();
    const body = await readFile(file);
    const isAsset = file.includes(`${join(root, 'assets')}`);
    res.writeHead(200, {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      // The service worker must be allowed to control the whole origin.
      ...(file.endsWith('sw.js') ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`T&C Budget is running at http://localhost:${port}/`);
});

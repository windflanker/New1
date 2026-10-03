// Local server for trying the portal on your own computer (the live site runs on
// Cloudflare Workers via src/worker.js). Uses MongoDB when MONGODB_URI is set,
// otherwise saves bookings to data/bookings.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './src/api.js';
import { MemoryStore } from './src/stores/memory.js';
import { MongoStore } from './src/stores/mongo.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  fs.readFile(file, (err, content) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
}
const notFound = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };

// Converts Node's request into a web Request, runs the shared API, writes the Response back.
async function serveApi(req, res, options) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await handleApi(request, options);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createServer(options) {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      return serveApi(req, res, options).catch((err) => {
        console.error(err);
        res.writeHead(500).end();
      });
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return undefined; }
    return serveStatic(res, pathname === '/admin' ? '/admin.html' : pathname);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const adminPin = process.env.ADMIN_PIN || 'maratha123';
  let store;
  if (process.env.MONGODB_URI) {
    // Locally one connection is kept for the whole run (Node allows this).
    store = MongoStore.connect(process.env.MONGODB_URI, process.env.MONGODB_DB || 'maratha_museum');
    console.log('Using MongoDB');
  } else {
    store = new MemoryStore(process.env.DATA_FILE || path.join(ROOT, 'data', 'bookings.json'));
    console.log('Using data/bookings.json (set MONGODB_URI to use MongoDB)');
  }
  createServer({ store, adminPin }).listen(port, () => {
    console.log(`Maratha Museum booking portal: http://localhost:${port}`);
    console.log(`Counter staff page:           http://localhost:${port}/admin`);
  });
}

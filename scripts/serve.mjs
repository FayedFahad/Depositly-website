import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {observabilityBuildOptions} from './observability.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Only the explicit development file is loaded. Values never enter static output.
try {
  const source = await readFile(path.join(root, '.env.local'), 'utf8');
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid .env.local entry on line ${index + 1}.`);
    let value = match[2];
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); }
      catch { throw new Error(`Invalid .env.local quotation on line ${index + 1}.`); }
      if (typeof value !== 'string') throw new Error(`Invalid .env.local value on line ${index + 1}.`);
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`Invalid .env.local quotation on line ${index + 1}.`);
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '').trimEnd();
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT || 4173);
const observability=(await build({...observabilityBuildOptions,write:false})).outputFiles[0].contents;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader('Cache-Control', 'no-store');
  let requestUrl;
  try { requestUrl = new URL(request.url, 'http://localhost'); }
  catch { response.writeHead(400); response.end('Bad request'); return; }
  if (requestUrl.pathname.startsWith('/api/')) {
    const route = /^\/api\/(auth|drive)\/([a-z-]+)\/?$/.exec(requestUrl.pathname);
    if (!route) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const handler = (await import(new URL(`../api/${route[1]}/[action].js`, import.meta.url))).default;
      request.query = { ...Object.fromEntries(requestUrl.searchParams), action: route[2] };
      await handler(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: 'The local API could not complete this request. Check the server setup.' }));
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  if(requestUrl.pathname==='/assets/observability.js'){
    response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Length':observability.length});
    response.end(request.method==='HEAD'?undefined:observability);return;
  }
  try {
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (pathname === '/privacy' || pathname === '/terms') pathname += '/index.html';
    const allowed = ['/index.html', '/config.js', '/favicon.ico', '/favicon.png', '/privacy/index.html', '/terms/index.html'].includes(pathname) || pathname.startsWith('/assets/');
    if (!allowed || pathname.includes('\\') || pathname.includes('\0')) throw new Error('Not found');
    const target = await realpath(path.resolve(root, `.${pathname}`));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(target)).isFile()) throw new Error('Not found');
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Depositly is ready at http://localhost:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

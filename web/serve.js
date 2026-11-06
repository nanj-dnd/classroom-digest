import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
http.createServer((req, res) => {
  const f = path.join(dir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(4173, () => console.log('dashboard preview on http://localhost:4173'));

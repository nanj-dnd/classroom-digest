import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();
export function pageFile(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(process.cwd(), 'pages', name), 'utf8'));
  return cache.get(name);
}

export function html(res, body, code = 200) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const message = (title, body) => pageFile('message.html')
  .replaceAll('{{title}}', esc(title))
  .replace('{{body}}', esc(body));

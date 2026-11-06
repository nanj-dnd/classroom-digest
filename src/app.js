import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, DATA_DIR, config, setEnv } from './config.js';
import { hasToken, authUrl, exchangeCode } from './auth.js';
import { chat } from './tutor.js';

// The local app: `npm start`, sign in with Google in the browser, and the
// dashboard plus the study buttons run on this machine. Nothing is hosted, and
// the Google token and Claude key never leave it.

const WEB = path.join(ROOT, 'web');
const PAYLOAD = path.join(DATA_DIR, 'payload.json');
const TOKEN = path.join(DATA_DIR, 'token.json');

const sync = { running: false, startedAt: null, finishedAt: null, error: null, log: [] };
let origin = '';
let oauthState = null;

function loadPayload() {
  try { return JSON.parse(fs.readFileSync(PAYLOAD, 'utf8')); } catch {}
  // Older installs only have the deployed site's copy.
  try {
    const js = fs.readFileSync(path.join(WEB, 'api', '_payload.js'), 'utf8');
    return JSON.parse(js.replace(/^export const PAYLOAD = /, '').replace(/;\s*$/, ''));
  } catch { return null; }
}

// Runs the same `sync` the CLI does, in a child process, so a crash in the
// Classroom pull can't take the app down with it.
function startSync() {
  if (sync.running) return;
  Object.assign(sync, { running: true, startedAt: new Date().toISOString(), error: null, log: [] });
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js'), 'sync'], { cwd: ROOT, env: process.env });
  const take = (buf) => {
    for (const line of buf.toString().split('\n')) if (line.trim()) sync.log.push(line);
    if (sync.log.length > 200) sync.log.splice(0, sync.log.length - 200);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('close', (code) => {
    sync.running = false;
    sync.finishedAt = new Date().toISOString();
    if (code !== 0) sync.error = sync.log.slice(-6).join('\n') || `sync exited with code ${code}`;
  });
}

const status = () => ({
  signedIn: hasToken(),
  hasKey: !!config.anthropicKey,
  hasData: !!loadPayload(),
  excludeCourses: config.excludeCourses.join(', '),
  model: config.claudeModel,
  sync: { ...sync, log: sync.log.slice(-8) },
});

function page(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 2e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

function dashboard() {
  const tpl = fs.readFileSync(path.join(WEB, 'template.html'), 'utf8');
  const head = '<link rel="stylesheet" href="/app/app.css"><script>window.CLASSROOM_APP=true</script>';
  return tpl
    .replace('</head>', `${head}\n</head>`)
    .replace('/*__DATA__*/null', JSON.stringify(loadPayload()).replace(/</g, '\\u003c'))
    .replace('</body>', '<script src="/app/app-ui.js"></script>\n</body>');
}

const welcome = () => fs.readFileSync(path.join(WEB, 'app', 'welcome.html'), 'utf8');

const STATIC = { '/app/app.css': 'text/css', '/app/app-ui.js': 'text/javascript' };

async function handle(req, res) {
  const u = new URL(req.url, origin);

  // Only answer requests addressed to this app by name. That stops DNS
  // rebinding, and stops other sites in the same browser from POSTing here
  // and spending the student's Claude key.
  const ours = [origin, origin.replace('localhost', '127.0.0.1')];
  if (!ours.some((o) => new URL(o).host === req.headers.host)) { res.writeHead(403).end(); return; }
  if (req.method === 'POST' && !ours.includes(req.headers.origin)) { res.writeHead(403).end(); return; }

  if (req.method === 'GET' && STATIC[u.pathname]) {
    res.writeHead(200, { 'Content-Type': STATIC[u.pathname], 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(WEB, u.pathname.slice(1))));
    return;
  }

  if (req.method === 'GET' && u.pathname === '/') {
    return page(res, hasToken() ? dashboard() : welcome());
  }

  if (req.method === 'GET' && u.pathname === '/signin') {
    oauthState = crypto.randomBytes(16).toString('hex');
    let to;
    try { to = authUrl(`${origin}/callback`, oauthState); } catch (e) {
      return page(res, `<body style="font:16px system-ui;padding:3rem;max-width:600px;line-height:1.5">
        <h2>No Google sign-in configured</h2><p>${e.message.replace(/[<>&]/g, '').replace(/\n/g, '<br>')}</p>
        <p>See "Using your own Google client" in the README, then restart with <code>npm start</code>.</p></body>`);
    }
    res.writeHead(302, { Location: to }).end();
    return;
  }

  if (req.method === 'GET' && u.pathname === '/callback') {
    const err = u.searchParams.get('error');
    if (err || u.searchParams.get('state') !== oauthState) {
      return page(res, `<body style="font:16px system-ui;padding:3rem">Sign-in didn't complete${err ? ` (${err.replace(/[<>&]/g, '')})` : ''}. <a href="/">Try again</a></body>`);
    }
    oauthState = null;
    await exchangeCode(u.searchParams.get('code'), `${origin}/callback`);
    startSync();
    res.writeHead(302, { Location: '/' }).end();
    return;
  }

  if (req.method === 'GET' && u.pathname === '/api/status') return json(res, 200, status());

  if (req.method === 'POST' && u.pathname === '/api/sync') { startSync(); return json(res, 200, status()); }

  if (req.method === 'POST' && u.pathname === '/api/settings') {
    const b = await readBody(req);
    if (typeof b.anthropicKey === 'string' && b.anthropicKey.trim()) {
      setEnv('ANTHROPIC_API_KEY', b.anthropicKey);
      config.anthropicKey = process.env.ANTHROPIC_API_KEY;
    }
    if (typeof b.excludeCourses === 'string') {
      setEnv('EXCLUDE_COURSES', b.excludeCourses);
      config.excludeCourses = process.env.EXCLUDE_COURSES.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return json(res, 200, status());
  }

  if (req.method === 'POST' && u.pathname === '/api/signout') {
    fs.rmSync(TOKEN, { force: true });
    return json(res, 200, status());
  }

  // One line of JSON per event, so the page can render text as it arrives.
  if (req.method === 'POST' && u.pathname === '/api/chat') {
    const b = await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    await chat({ action: b.action, target: b.target, history: b.history || [], emit: (e) => res.write(JSON.stringify(e) + '\n') });
    res.end();
    return;
  }

  res.writeHead(404).end();
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve(listen(server, 0)) : reject(e)));
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

export async function startApp() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e.message });
      else res.end();
    });
  });
  const port = await listen(server, config.appPort);
  origin = `http://localhost:${port}`;
  console.log(`\nClassroom Digest is running at ${origin}\nLeave this window open while you use it. Ctrl+C stops it.\n`);
  if (!process.argv.includes('--no-open')) {
    try { (await import('open')).default(origin); } catch {}
  }
  // Fresh data on every launch, once signed in.
  if (hasToken()) startSync();
  await new Promise(() => {});
}

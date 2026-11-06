import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';
import { ROOT, DATA_DIR, config } from './config.js';

const TOKEN_PATH = path.join(DATA_DIR, 'token.json');
const CRED_PATH = path.join(ROOT, 'credentials.json');
const PREFERRED_PORT = 8419;

// Grouped so that if your Workspace admin blocks one group, the rest still work.
export const SCOPE_GROUPS = {
  core: [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly',
    'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  ],
  // drive.readonly is a RESTRICTED scope — the likeliest to be blocked by an
  // education tenant. Set SYNC_DRIVE=false to drop it and keep everything else.
  drive: ['https://www.googleapis.com/auth/drive.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
};

export function activeScopes() {
  return [
    ...SCOPE_GROUPS.core,
    ...(config.syncDrive ? SCOPE_GROUPS.drive : []),
    ...(config.syncCalendar ? SCOPE_GROUPS.calendar : []),
  ];
}

function credentials() {
  if (!fs.existsSync(CRED_PATH)) {
    throw new Error(
      `Missing credentials.json at ${CRED_PATH}.\n` +
      `Download a Desktop-app OAuth client, then run: node src/index.js adopt`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const c = raw.installed || raw.web;
  if (!c) throw new Error('credentials.json is not a Desktop-app OAuth client.');
  return c;
}

function oauthClient(redirectUri) {
  const c = credentials();
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
}

// Desktop-app clients may use any loopback port, so rather than fighting over a
// fixed one we take whatever is free. An abandoned earlier run can no longer
// wedge the flow with EADDRINUSE.
function listenOnFreePort(server) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      if (e.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.listen(0, () => resolve(server.address().port)); // 0 = kernel picks
      } else reject(e);
    };
    server.once('error', onError);
    server.listen(PREFERRED_PORT, () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    });
  });
}

export async function authorize() {
  let server, timer;
  const done = (fn) => { clearTimeout(timer); server.closeAllConnections?.(); server.close(); return fn; };

  const code = await new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
      // Tear the server down only once the page has actually flushed, or the
      // browser shows a connection error on an otherwise successful auth.
      res.end(
        `<body style="font:16px system-ui;padding:3rem">${err ? 'Denied: ' + err : 'Authorized. Close this tab.'}</body>`,
        () => (err ? done(reject)(new Error(err)) : done(resolve)(u.searchParams.get('code')))
      );
    });

    listenOnFreePort(server).then(async (port) => {
      const url = oauthClient(`http://localhost:${port}/callback`).generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: activeScopes(),
      });
      // Don't leave a listener wedged on the port if consent is abandoned.
      timer = setTimeout(() => done(reject)(new Error('Timed out after 5 minutes waiting for consent. Rerun: npm run auth')), 5 * 60e3);
      console.log(`\nListening on port ${port}. Opening your browser...`);
      console.log('Sign in with the account your Classroom is on.');
      console.log('If it does not open, paste this:\n\n' + url + '\n');
      try { (await import('open')).default(url); } catch {}
      server._redirectUri = `http://localhost:${port}/callback`;
    }, reject);
  });

  const client = oauthClient(server._redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log('Saved token to data/token.json');
  return client;
}

export async function getClient() {
  if (!fs.existsSync(TOKEN_PATH)) return authorize();
  const client = oauthClient(`http://localhost:${PREFERRED_PORT}/callback`);
  client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  client.on('tokens', (t) => {
    const cur = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...cur, ...t }, null, 2), { mode: 0o600 });
  });
  try {
    await client.getAccessToken();
  } catch (e) {
    // While the OAuth app is in "Testing", refresh tokens die after 7 days.
    // Fail loudly rather than letting the cron quietly stop working.
    throw new Error(
      'Google refused the refresh token (' + (e.message || e) + ').\n' +
      'If your OAuth app is still in Testing status this happens every 7 days.\n' +
      'Fix: npm run auth   — or publish the consent screen to Production.'
    );
  }
  return client;
}

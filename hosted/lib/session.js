import crypto from 'node:crypto';

// Nothing about a user is stored on the server. The Google refresh token lives
// in an HttpOnly cookie, encrypted with AES-256-GCM under SESSION_SECRET, so the
// browser holds it but can't read it, and nobody else can forge or open one.

const SESSION = 'cd_session';
const STATE = 'cd_state';
const PREFS = 'cd_prefs';
const MONTH = 30 * 24 * 3600;
const YEAR = 365 * 24 * 3600;

function key() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters.');
  return crypto.createHash('sha256').update(s).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function unseal(token) {
  try {
    const buf = Buffer.from(String(token), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}

export const cookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? ['', ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));

const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

export function setCookies(res, list) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), ...list]);
}

export const getSession = (req) => {
  const s = unseal(cookies(req)[SESSION] || '');
  // Sessions from before accounts had ids are treated as signed out.
  return s && s.rt && s.sub ? s : null;
};
export const sessionCookie = (s) => cookie(SESSION, seal(s), MONTH);
export const clearSession = () => [cookie(SESSION, '', 0), cookie(PREFS, '', 0)];

export const stateCookie = (v) => cookie(STATE, v, 600);
export const getState = (req) => cookies(req)[STATE] || '';
export const clearState = () => cookie(STATE, '', 0);

// Which courses the student has hidden (finished semesters stay ACTIVE in
// Classroom). Just preferences, but sealed so the cookie stays opaque.
export function getPrefs(req) {
  const p = unseal(cookies(req)[PREFS] || '');
  return p && Array.isArray(p.hidden) ? p : null;
}
export const prefsCookie = (p) => cookie(PREFS, seal(p), YEAR);

// POSTs only from our own pages, so another site can't sign a student out or
// change their settings from a hidden form.
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (o && o !== 'null') {
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  }
  // Our Referrer-Policy is no-referrer, and under it browsers send
  // "Origin: null" on a plain <form> POST (the connect page's "Continue to
  // Google"). Sec-Fetch-Site is unaffected by that policy and no page can set
  // it, so it settles the question when Origin can't.
  return req.headers['sec-fetch-site'] === 'same-origin';
}

export const origin = (req) => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

export function safeEqualState(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

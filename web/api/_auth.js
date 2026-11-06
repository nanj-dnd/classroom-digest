import crypto from 'node:crypto';

const SECRET = process.env.AUTH_SECRET || '';
const TTL_CHALLENGE = 10 * 60;          // seconds a code stays valid
const TTL_SESSION = 30 * 24 * 3600;     // stay signed in a month

export const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

// Constant-time compare so a wrong code can't be found by timing the response.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? ['', ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));

export const setCookie = (res, name, value, maxAge) =>
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);

export function issueChallenge(code) {
  const exp = Math.floor(Date.now() / 1000) + TTL_CHALLENGE;
  return { token: `${exp}.${sign(`${code}.${exp}`)}`, exp };
}

export function checkChallenge(token, code) {
  if (!token) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, sign(`${code}.${exp}`));
}

export function issueSession() {
  const exp = Math.floor(Date.now() / 1000) + TTL_SESSION;
  return { token: `${exp}.${sign(`session.${exp}`)}`, maxAge: TTL_SESSION };
}

export function checkSession(token) {
  if (!token || !SECRET) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, sign(`session.${exp}`));
}

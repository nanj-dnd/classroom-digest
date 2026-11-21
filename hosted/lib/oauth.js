import crypto from 'node:crypto';
import { seal, unseal } from './session.js';

// The connector's OAuth server, with no database. Every artefact it hands
// out (client ids, codes, tokens) is a sealed packet only this server can
// open, tagged with its type so one can never be passed off as another.

export const ACCESS_TTL = 3600;          // seconds
const CODE_TTL = 5 * 60;
const REFRESH_TTL = 90 * 24 * 3600;

export const issue = (typ, body, ttl) => seal({ typ, ...body, exp: ttl ? Date.now() + ttl * 1000 : undefined });

export function open(typ, token) {
  const p = unseal(token || '');
  if (!p || p.typ !== typ) return null;
  if (p.exp && p.exp < Date.now()) return null;
  return p;
}

export const issueCode = (b) => issue('code', b, CODE_TTL);
export const issueAccess = (b) => issue('at', b, ACCESS_TTL);
export const issueRefresh = (b) => issue('rt', b, REFRESH_TTL);

export function pkceOk(verifier, challenge) {
  if (!verifier || !challenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const h = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(h), b = Buffer.from(String(challenge));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// claude.ai uses an https callback; Claude Code and the MCP Inspector use a
// loopback one. Nothing else is accepted.
export function okRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

export const base = (req) => `https://${req.headers.host}`;

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
}

export function readForm(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') return Object.fromEntries(new URLSearchParams(b));
  if (Buffer.isBuffer(b)) return Object.fromEntries(new URLSearchParams(b.toString('utf8')));
  return b;
}

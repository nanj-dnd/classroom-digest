import { getSession, clearSession, setCookies, sameOrigin } from '../lib/session.js';
import { revoke } from '../lib/google.js';
import { json } from '../lib/http.js';

// Revokes the grant at Google too, so signing out really removes access.
export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const s = getSession(req);
  if (s) await revoke(s.rt);
  setCookies(res, clearSession());
  json(res, 200, { ok: true });
}

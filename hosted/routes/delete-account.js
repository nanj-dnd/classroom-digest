import { getSession, clearSession, setCookies, sameOrigin } from '../lib/session.js';
import { remove } from '../lib/store.js';
import { revoke } from '../lib/google.js';
import { json } from '../lib/http.js';

// Deletes everything stored for the student, revokes Google, signs out.
export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const s = getSession(req);
  if (!s) return json(res, 401, { error: 'signed-out' });
  try { await remove(s.sub); } catch (e) { console.error('delete', e.message); return json(res, 502, { error: 'Could not delete your data. Try again.' }); }
  await revoke(s.rt);
  setCookies(res, clearSession());
  json(res, 200, { ok: true });
}

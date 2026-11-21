import { getSession, prefsCookie, setCookies, sameOrigin } from '../lib/session.js';
import { json } from '../lib/http.js';

export default function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  if (!getSession(req)) return json(res, 401, { error: 'signed-out' });
  const hidden = (Array.isArray(req.body?.hidden) ? req.body.hidden : [])
    .map(String).filter((id) => /^[0-9A-Za-z_-]{1,40}$/.test(id)).slice(0, 200);
  setCookies(res, [prefsCookie({ hidden })]);
  json(res, 200, { ok: true });
}

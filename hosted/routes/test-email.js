import { sameOrigin } from '../lib/session.js';
import { requireUser, classroomError } from '../lib/auth.js';
import { loadOrBlank } from '../lib/store.js';
import { loadDigest, zoneOffset } from '../lib/load.js';
import { compose, send } from '../lib/email.js';
import { base } from '../lib/oauth.js';
import { json } from '../lib/http.js';

// "Send me one now", with the student's current choices.
export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const u = await requireUser(req, res);
  if (!u) return;
  if (!u.s.email) return json(res, 400, { error: 'Google did not share a verified email for this account.' });
  let p, doc;
  try {
    doc = await loadOrBlank(u.s.sub, u.s.email);
    p = await loadDigest(u.at, doc, zoneOffset(doc.tz));
  } catch (e) { return classroomError(res, e); }
  try {
    const mail = compose(p, doc, { since: Date.now() - 7 * 864e5, base: base(req) });
    await send(u.s.email, mail);
    json(res, 200, { ok: true, to: u.s.email, subject: mail.subject });
  } catch (e) { console.error('test email', e.message); json(res, 502, { error: 'The email could not be sent. Try again in a few minutes.' }); }
}

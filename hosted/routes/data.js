import { requireUser, classroomError } from '../lib/auth.js';
import { loadOrBlank } from '../lib/store.js';
import { loadDigest } from '../lib/load.js';
import { json } from '../lib/http.js';

export default async function handler(req, res) {
  const u = await requireUser(req, res);
  if (!u) return;
  let doc;
  try { doc = await loadOrBlank(u.s.sub, u.s.email); }
  catch (e) { console.error('store', e.message); return json(res, 502, { error: 'Could not load your settings. Try again in a minute.' }); }
  try {
    const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
    const p = await loadDigest(u.at, doc, tz);
    p.me = { email: u.s.email, tz: doc.tz, reminders: doc.reminders, hasSettings: !!doc.updatedAt, priorities: doc.priorities || [], onboarded: !!doc.onboarded };
    json(res, 200, p);
  } catch (e) { classroomError(res, e); }
}

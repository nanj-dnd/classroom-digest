import { getSession, sameOrigin } from '../lib/session.js';
import { loadOrBlank, save, DEFAULT_REMINDERS, PRIORITIES } from '../lib/store.js';
import { validZone } from '../lib/load.js';
import { json } from '../lib/http.js';

const ID = /^[0-9A-Za-z_:.-]{1,120}$/;
const clip = (s, n) => String(s ?? '').slice(0, n);

// One endpoint for every setting. Each field is optional and validated.
export default async function handler(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  const s = getSession(req);
  if (!s) return json(res, 401, { error: 'signed-out' });
  const b = req.body || {};
  try {
    const doc = await loadOrBlank(s.sub, s.email);

    if (Array.isArray(b.hiddenCourses)) doc.hiddenCourses = b.hiddenCourses.map(String).filter((x) => ID.test(x)).slice(0, 200);

    if (b.hide && ID.test(b.hide.id || '')) {
      doc.hiddenTasks = (doc.hiddenTasks || []).filter((t) => t.id !== b.hide.id);
      doc.hiddenTasks.unshift({ id: b.hide.id, title: clip(b.hide.title, 200), course: clip(b.hide.course, 120), link: /^https:\/\//.test(b.hide.link || '') ? clip(b.hide.link, 400) : '' });
      doc.hiddenTasks = doc.hiddenTasks.slice(0, 300);
    }
    if (typeof b.unhide === 'string') doc.hiddenTasks = (doc.hiddenTasks || []).filter((t) => t.id !== b.unhide);

    if (typeof b.tz === 'string' && validZone(b.tz)) doc.tz = b.tz;
    if (Array.isArray(b.priorities)) doc.priorities = [...new Set(b.priorities.filter((x) => PRIORITIES.includes(x)))];
    if (typeof b.onboarded === 'boolean') doc.onboarded = b.onboarded;

    if (b.reminders && typeof b.reminders === 'object') {
      const r = b.reminders, cur = doc.reminders || structuredClone(DEFAULT_REMINDERS);
      const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))] : cur.days;
      const hour = Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 ? r.hour : cur.hour;
      const include = { ...cur.include };
      for (const k of Object.keys(DEFAULT_REMINDERS.include)) if (typeof r.include?.[k] === 'boolean') include[k] = r.include[k];
      doc.reminders = { on: typeof r.on === 'boolean' ? r.on : cur.on, days, hour, include, skipEmpty: typeof r.skipEmpty === 'boolean' ? r.skipEmpty : cur.skipEmpty };
      if (doc.reminders.on && !s.email) return json(res, 400, { error: 'Google did not share a verified email for this account, so reminders cannot be sent.' });
      // The sign-in is kept server-side only while reminders are on.
      doc.rt = doc.reminders.on ? s.rt : null;
      if (doc.reminders.on) doc.email = s.email;
    }

    await save(doc);
    json(res, 200, { ok: true, me: { email: s.email, tz: doc.tz, reminders: doc.reminders, priorities: doc.priorities || [], onboarded: !!doc.onboarded }, hidden: doc.hiddenTasks });
  } catch (e) {
    console.error('prefs', e.message);
    json(res, 502, { error: 'Could not save that. Try again.' });
  }
}

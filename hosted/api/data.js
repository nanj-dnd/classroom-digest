import { getSession, sessionCookie, clearSession, setCookies, getPrefs } from '../lib/session.js';
import { refresh, listCourses, fetchCourse } from '../lib/google.js';
import { buildPayload, defaultHidden } from '../lib/digest.js';
import { json } from '../lib/http.js';

export default async function handler(req, res) {
  const s = getSession(req);
  if (!s) return json(res, 401, { error: 'signed-out' });

  // Reuse the access token while it's fresh; otherwise refresh and re-seal.
  let at = s.at;
  if (!at || !s.exp || s.exp < Date.now()) {
    try {
      const t = await refresh(s.rt);
      at = t.access_token;
      setCookies(res, [sessionCookie({ ...s, at, exp: Date.now() + (t.expires_in - 60) * 1000 })]);
    } catch (e) {
      if (e.code === 'invalid_grant') { setCookies(res, clearSession()); return json(res, 401, { error: 'signed-out' }); }
      console.error('refresh', e.message);
      return json(res, 502, { error: 'Google sign-in could not be refreshed. Try again in a minute.' });
    }
  }

  try {
    const all = await listCourses(at);
    const hidden = new Set(getPrefs(req)?.hidden ?? defaultHidden(all));
    const visible = all.filter((c) => !hidden.has(c.id));
    const courses = await Promise.all(visible.map((c) => fetchCourse(at, c)));
    const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
    const payload = buildPayload(courses, new Date(), tz);
    const t = (c) => Date.parse(c.creationTime || '') || 0;
    payload.courses = all
      .sort((a, b) => t(b) - t(a))
      .map((c) => ({ id: c.id, name: c.name || '(untitled course)', section: c.section || '', hidden: hidden.has(c.id) }));
    json(res, 200, payload);
  } catch (e) {
    if (e.status === 401) { setCookies(res, clearSession()); return json(res, 401, { error: 'signed-out' }); }
    console.error('classroom', e.status, e.message);
    json(res, 502, { error: e.status === 403
      ? 'Classroom refused access. Your school may block third-party apps; ask its Google Workspace admin.'
      : 'Could not load your Classroom right now. Try again in a minute.' });
  }
}

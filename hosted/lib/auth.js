import { getSession, sessionCookie, clearSession, setCookies } from './session.js';
import { refresh } from './google.js';
import { json } from './http.js';

// The signed-in student and a live Google access token, or a 401 already sent.
export async function requireUser(req, res) {
  const s = getSession(req);
  if (!s) { json(res, 401, { error: 'signed-out' }); return null; }
  if (s.at && s.exp > Date.now()) return { s, at: s.at };
  try {
    const t = await refresh(s.rt);
    setCookies(res, [sessionCookie({ ...s, at: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 })]);
    return { s, at: t.access_token };
  } catch (e) {
    if (e.code === 'invalid_grant') { setCookies(res, clearSession()); json(res, 401, { error: 'signed-out' }); return null; }
    console.error('refresh', e.message);
    json(res, 502, { error: 'Google sign-in could not be refreshed. Try again in a minute.' });
    return null;
  }
}

export function classroomError(res, e) {
  if (e.status === 401) { setCookies(res, clearSession()); return json(res, 401, { error: 'signed-out' }); }
  console.error('classroom', e.status, e.message);
  json(res, 502, { error: e.status === 403
    ? 'Classroom refused access. Your school may block third-party apps; ask its Google Workspace admin.'
    : 'Could not load your Classroom right now. Try again in a minute.' });
}

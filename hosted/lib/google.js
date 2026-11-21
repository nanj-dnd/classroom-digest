// Google sign-in and the Classroom REST API, with plain fetch so the function
// ships with no dependencies.

export const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
];

// Google sometimes reports a granted scope under its older name, or the
// student may already hold the broader read-write scope. Either covers ours.
const C = 'https://www.googleapis.com/auth/classroom.';
const EQUIVALENT = {
  [`${C}coursework.me.readonly`]: [`${C}student-submissions.me.readonly`, `${C}coursework.me`, `${C}student-submissions.me`],
  [`${C}courses.readonly`]: [`${C}courses`],
  [`${C}announcements.readonly`]: [`${C}announcements`],
  [`${C}courseworkmaterials.readonly`]: [`${C}courseworkmaterials`],
};

export function missingScopes(grantedString) {
  const granted = new Set(String(grantedString || '').split(/[\s+]+/).filter(Boolean));
  return SCOPES.filter((s) => !granted.has(s) && !(EQUIVALENT[s] || []).some((e) => granted.has(e)));
}

const client = () => {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
  return { id, secret };
};

export function authUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params) {
  const { id, secret } = client();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `Google token endpoint returned ${r.status}`);
    e.code = j.error;
    throw e;
  }
  return j;
}

export const exchangeCode = (code, redirectUri) =>
  token({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });

export const refresh = (refreshToken) =>
  token({ refresh_token: refreshToken, grant_type: 'refresh_token' });

export async function revoke(t) {
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }); } catch {}
}

const API = 'https://classroom.googleapis.com/v1';

async function get(accessToken, path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error?.message || `Classroom returned ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

async function pageAll(accessToken, path, params, field) {
  const out = [];
  let pageToken;
  do {
    const j = await get(accessToken, path, { ...params, pageSize: 100, ...(pageToken ? { pageToken } : {}) });
    out.push(...(j[field] || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

// One course's blocked list shouldn't sink the whole page.
const soft = (p) => p.catch(() => []);

export const listCourses = (t) =>
  pageAll(t, '/courses', { studentId: 'me', courseStates: 'ACTIVE' }, 'courses');

export async function fetchCourse(t, course) {
  const base = `/courses/${course.id}`;
  const [coursework, submissions, announcements, materials] = await Promise.all([
    soft(pageAll(t, `${base}/courseWork`, { courseWorkStates: 'PUBLISHED' }, 'courseWork')),
    soft(pageAll(t, `${base}/courseWork/-/studentSubmissions`, { userId: 'me' }, 'studentSubmissions')),
    soft(pageAll(t, `${base}/announcements`, { announcementStates: 'PUBLISHED' }, 'announcements')),
    soft(pageAll(t, `${base}/courseWorkMaterials`, { courseWorkMaterialStates: 'PUBLISHED' }, 'courseWorkMaterial')),
  ]);
  const byWork = new Map(submissions.map((s) => [s.courseWorkId, s]));
  return {
    id: course.id,
    name: (course.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || course.name || '(untitled course)',
    link: course.alternateLink,
    coursework: coursework.map((w) => ({ ...w, submission: byWork.get(w.id) || null })),
    announcements,
    materials,
  };
}

export const getCourse = (t, id) => get(t, `/courses/${encodeURIComponent(id)}`);

export async function getAssignment(t, courseId, workId) {
  const base = `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(workId)}`;
  const [work, subs] = await Promise.all([
    get(t, base),
    soft(pageAll(t, `${base}/studentSubmissions`, { userId: 'me' }, 'studentSubmissions')),
  ]);
  return { ...work, submission: subs[0] || null };
}

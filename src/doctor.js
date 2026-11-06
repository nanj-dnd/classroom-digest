import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { ROOT, DATA_DIR, config } from './config.js';
import { SCOPE_GROUPS } from './auth.js';

const ok = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const meh = (s) => `  \x1b[33m–\x1b[0m ${s}`;

// Turn Google's errors into the one sentence that tells you what to actually do.
function diagnose(e) {
  const status = e?.code || e?.response?.status;
  const data = e?.response?.data || {};
  const msg = data?.error?.message || data?.error_description || e?.message || String(e);
  const reason = data?.error?.errors?.[0]?.reason || data?.error;

  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) {
    const api = msg.match(/([a-z]+\.googleapis\.com)/)?.[1] || 'the API';
    return `API NOT ENABLED — turn on ${api} in your Cloud project, wait ~1 min, retry.`;
  }
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(msg)) {
    return `SCOPE MISSING from your token — rerun: npm run auth`;
  }
  if (reason === 'invalid_grant' || /invalid_grant/i.test(msg)) {
    return `TOKEN DEAD — OAuth app in "Testing" expires refresh tokens every 7 days. Rerun: npm run auth`;
  }
  if (/admin_policy_enforced|blocked_by_admin/i.test(msg)) {
    return `BLOCKED BY YOUR WORKSPACE ADMIN — this scope is not allowlisted for your school's Workspace.`;
  }
  if (status === 403) return `FORBIDDEN (403) — likely admin policy or a scope you did not grant. ${msg}`;
  if (status === 401) return `UNAUTHORIZED (401) — rerun: npm run auth`;
  return `${status || ''} ${msg}`;
}

async function probe(label, fn) {
  try {
    const v = await fn();
    console.log(ok(`${label}${v ? ' — ' + v : ''}`));
    return true;
  } catch (e) {
    console.log(bad(`${label}`));
    console.log(`      ${diagnose(e)}`);
    return false;
  }
}

export async function doctor(getClient) {
  let fatal = false;

  console.log('\nCredentials');
  const cred = path.join(ROOT, 'credentials.json');
  if (!fs.existsSync(cred)) {
    console.log(bad('credentials.json missing — download a Desktop-app OAuth client into ' + ROOT));
    return false;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cred, 'utf8'));
    if (raw.web && !raw.installed) {
      console.log(bad('credentials.json is a "Web application" client. Classroom-digest needs application type = Desktop app.'));
      return false;
    }
    if (!raw.installed) { console.log(bad('credentials.json is not an OAuth client file.')); return false; }
    console.log(ok(`Desktop client ${raw.installed.client_id.slice(0, 24)}…`));
    console.log(ok(`project ${raw.installed.project_id || '(unnamed)'}`));
  } catch (e) {
    console.log(bad('credentials.json is not valid JSON: ' + e.message));
    return false;
  }

  console.log('\nToken');
  if (!fs.existsSync(path.join(DATA_DIR, 'token.json'))) {
    console.log(meh('no token yet — run: npm run auth'));
    return false;
  }
  let auth;
  try {
    auth = await getClient();
    console.log(ok('refresh token accepted'));
  } catch (e) {
    console.log(bad(e.message.split('\n')[0]));
    console.log(`      ${diagnose(e)}`);
    return false;
  }

  console.log('\nClassroom (core)');
  const cr = google.classroom({ version: 'v1', auth });
  let firstCourse = null;
  const gotCourses = await probe('courses.list', async () => {
    const r = await cr.courses.list({ studentId: 'me', courseStates: ['ACTIVE'], pageSize: 50 });
    const cs = r.data.courses || [];
    firstCourse = cs[0] || null;
    return `${cs.length} active course(s)` + (cs.length ? `: ${cs.map((c) => c.name).join(', ')}` : '');
  });
  if (!gotCourses) fatal = true;

  if (firstCourse) {
    const id = firstCourse.id;
    let firstWork = null;
    await probe('courseWork.list', async () => {
      const r = await cr.courses.courseWork.list({ courseId: id, courseWorkStates: ['PUBLISHED'], pageSize: 50 });
      const w = r.data.courseWork || [];
      firstWork = w[0] || null;
      return `${w.length} assignment(s) in "${firstCourse.name}"`;
    });
    await probe('studentSubmissions.list', async () => {
      const r = await cr.courses.courseWork.studentSubmissions.list({ courseId: id, courseWorkId: '-', userId: 'me', pageSize: 50 });
      const s = r.data.studentSubmissions || [];
      const states = {};
      for (const x of s) states[x.state] = (states[x.state] || 0) + 1;
      return `${s.length} submission(s) ${JSON.stringify(states)}`;
    });
    await probe('announcements.list', async () => {
      const r = await cr.courses.announcements.list({ courseId: id, pageSize: 10 });
      return `${(r.data.announcements || []).length} announcement(s)`;
    });
    await probe('courseWorkMaterials.list', async () => {
      const r = await cr.courses.courseWorkMaterials.list({ courseId: id, pageSize: 10 });
      return `${(r.data.courseWorkMaterial || []).length} material(s)`;
    });
  } else if (gotCourses) {
    console.log(meh('no active courses — is Classroom on a different Google account?'));
  }

  console.log(`\nDrive  ${config.syncDrive ? '' : '(SYNC_DRIVE=false, skipped)'}`);
  if (config.syncDrive) {
    const good = await probe('drive.files.list', async () => {
      const d = google.drive({ version: 'v3', auth });
      const r = await d.files.list({ pageSize: 1, fields: 'files(id)' });
      return 'readable';
    });
    if (!good) console.log(meh('set SYNC_DRIVE=false in .env — everything else still works without it'));
  }

  console.log(`\nCalendar  ${config.syncCalendar ? '' : '(SYNC_CALENDAR=false, skipped)'}`);
  if (config.syncCalendar) {
    const good = await probe('calendarList.list', async () => {
      const c = google.calendar({ version: 'v3', auth });
      const r = await c.calendarList.list({ maxResults: 250 });
      const has = (r.data.items || []).some((x) => x.summary === config.calendarName);
      return `${(r.data.items || []).length} calendar(s)` + (has ? `, "${config.calendarName}" exists` : `, "${config.calendarName}" will be created`);
    });
    if (!good) console.log(meh('set SYNC_CALENDAR=false in .env to skip calendar sync'));
  }

  console.log(`\nEmail`);
  if (config.resendKey && config.digestFrom && config.digestTo) console.log(ok(`will send to ${config.digestTo}`));
  else console.log(meh('not configured — digests print to terminal only (fine for now)'));

  console.log(fatal ? '\nClassroom itself is not reachable. Fix the errors above first.\n' : '\nConnection looks good. Next: node src/index.js sync\n');
  return !fatal;
}

// Dump raw API shapes so assumptions can be checked against reality.
export async function dump(getClient) {
  const auth = await getClient();
  const cr = google.classroom({ version: 'v1', auth });
  const courses = (await cr.courses.list({ studentId: 'me', courseStates: ['ACTIVE'], pageSize: 5 })).data.courses || [];
  const out = { courses: [] };
  for (const c of courses.slice(0, 2)) {
    const work = (await cr.courses.courseWork.list({ courseId: c.id, pageSize: 3 })).data.courseWork || [];
    const subs = (await cr.courses.courseWork.studentSubmissions.list({ courseId: c.id, courseWorkId: '-', userId: 'me', pageSize: 3 })).data.studentSubmissions || [];
    out.courses.push({ course: c, courseWork: work, studentSubmissions: subs });
  }
  const f = path.join(DATA_DIR, 'raw-shapes.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`Raw API response shapes written to ${f}`);
}

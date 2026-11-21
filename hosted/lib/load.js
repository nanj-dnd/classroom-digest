import { listCourses, fetchCourse } from './google.js';
import { buildPayload, defaultHidden, ORDER } from './digest.js';

// Everything a student sees, with their hidden courses and tasks applied.
// The dashboard, test emails and the daily reminder job all go through here.
export async function loadDigest(accessToken, doc, tzOffset = 0) {
  const all = await listCourses(accessToken);
  const hiddenCourses = new Set(doc.hiddenCourses ?? defaultHidden(all));
  const visible = all.filter((c) => !hiddenCourses.has(c.id));
  const courses = await Promise.all(visible.map((c) => fetchCourse(accessToken, c)));
  const p = buildPayload(courses, new Date(), tzOffset);

  const hiddenIds = new Set((doc.hiddenTasks || []).map((t) => t.id));
  for (const b of ORDER) {
    if (!p.buckets[b]) continue;
    p.buckets[b] = p.buckets[b].filter((i) => !hiddenIds.has(i.id));
    if (!p.buckets[b].length) delete p.buckets[b];
  }
  p.mentioned = p.mentioned.filter((m) => !hiddenIds.has(m.id));
  p.hidden = doc.hiddenTasks || [];

  const t = (c) => Date.parse(c.creationTime || '') || 0;
  p.courses = all.sort((a, b) => t(b) - t(a))
    .map((c) => ({ id: c.id, name: c.name || '(untitled course)', section: c.section || '', hidden: hiddenCourses.has(c.id) }));
  return p;
}

// IANA zone → minutes as Date#getTimezoneOffset() would give (UTC − local).
export function zoneOffset(tz, at = new Date()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]));
    const local = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((Math.floor(at.getTime() / 60e3) * 60e3 - local) / 60e3);
  } catch { return 0; }
}

export const validZone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

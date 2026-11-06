import { google } from 'googleapis';
import { config, aliases } from './config.js';

// Walk every page of a list endpoint and concatenate one field.
async function pageAll(fn, params, field) {
  const out = [];
  let pageToken;
  do {
    const res = await fn({ ...params, pageToken, pageSize: 100 });
    out.push(...(res.data[field] || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

// A blocked scope or an archived course should degrade, not crash the run.
async function soft(label, p) {
  try {
    return await p;
  } catch (e) {
    const code = e?.code || e?.response?.status;
    console.warn(`  ! ${label}: ${code || ''} ${e?.message || e}`);
    return [];
  }
}

export async function fetchEverything(auth) {
  const cr = google.classroom({ version: 'v1', auth });

  const all = (
    await pageAll(cr.courses.list.bind(cr.courses), { studentId: 'me', courseStates: ['ACTIVE'] }, 'courses')
  ).filter(Boolean);

  const courses = all.filter(
    (c) => !config.excludeCourses.some((x) => (c.name || '').toLowerCase().includes(x.toLowerCase()))
  );
  const skipped = all.length - courses.length;
  console.log(`Found ${courses.length} active course(s)${skipped ? ` (${skipped} excluded)` : ''}.`);

  const result = [];
  for (const course of courses) {
    console.log(`- ${course.name}`);

    const coursework = await soft('coursework', pageAll(
      cr.courses.courseWork.list.bind(cr.courses.courseWork),
      { courseId: course.id, courseWorkStates: ['PUBLISHED'] },
      'courseWork'
    ));

    // courseWorkId "-" returns submissions across ALL coursework in one call.
    const submissions = await soft('submissions', pageAll(
      cr.courses.courseWork.studentSubmissions.list.bind(cr.courses.courseWork.studentSubmissions),
      { courseId: course.id, courseWorkId: '-', userId: 'me' },
      'studentSubmissions'
    ));

    const announcements = await soft('announcements', pageAll(
      cr.courses.announcements.list.bind(cr.courses.announcements),
      { courseId: course.id, announcementStates: ['PUBLISHED'] },
      'announcements'
    ));

    const materials = await soft('materials', pageAll(
      cr.courses.courseWorkMaterials.list.bind(cr.courses.courseWorkMaterials),
      { courseId: course.id, courseWorkMaterialStates: ['PUBLISHED'] },
      'courseWorkMaterial'
    ));

    const subByWork = new Map();
    for (const s of submissions) subByWork.set(s.courseWorkId, s);

    result.push({
      id: course.id,
      name: shortName(course.name),
      baseName: baseName(course.name),
      fullName: course.name,
      section: course.section || '',
      link: course.alternateLink,
      coursework: coursework.map((w) => ({ ...w, submission: subByWork.get(w.id) || null })),
      announcements,
      materials,
    });
  }
  return result;
}

// "ECO-2201 (Monsoon 2026)" -> "ECO-2201". The term is the same on every row.
// The bare course code, e.g. "ECO-2101". Stable: never affected by aliases,
// so folder names on disk don't move when a display label changes.
export function baseName(name) {
  return (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || name;
}

export function shortName(name) {
  const base = baseName(name);
  return aliases[base] ? `${aliases[base]} (${base})` : base;
}

// Classroom returns due date/time as separate UTC parts, with time often absent.
export function dueAt(work) {
  if (!work.dueDate) return null;
  const { year, month, day } = work.dueDate;
  const t = work.dueTime || {};
  return new Date(Date.UTC(year, month - 1, day, t.hours ?? 23, t.minutes ?? 59, 0));
}

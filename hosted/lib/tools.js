import { listCourses, fetchCourse, getCourse, getAssignment } from './google.js';
import { buildPayload, defaultHidden } from './digest.js';

// The connector's tools. Every one is read-only: Classroom Digest can't
// post, edit or submit anything, so neither can Claude through it.

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DONE = new Set(['TURNED_IN', 'RETURNED']);

function due(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate, t = w.dueTime || {};
  return new Date(Date.UTC(year, month - 1, day, t.hours ?? 23, t.minutes ?? 59)).toISOString();
}

function materials(list) {
  return (list || []).map((m) =>
    m.driveFile ? { type: 'drive file', title: m.driveFile.driveFile?.title, link: m.driveFile.driveFile?.alternateLink }
    : m.link ? { type: 'link', title: m.link.title || m.link.url, link: m.link.url }
    : m.youtubeVideo ? { type: 'video', title: m.youtubeVideo.title, link: m.youtubeVideo.alternateLink }
    : m.form ? { type: 'form', title: m.form.title, link: m.form.formUrl }
    : { type: 'other' });
}

function status(s) {
  if (!s) return 'not started';
  if (s.state === 'RETURNED') return 'returned';
  if (s.state === 'TURNED_IN') return 'turned in';
  if (s.state === 'RECLAIMED_BY_STUDENT') return 'unsubmitted';
  return s.state === 'CREATED' ? 'draft started' : 'not started';
}

const assignmentRow = (w) => ({
  id: w.id, title: w.title, due: due(w), points: w.maxPoints ?? null, status: status(w.submission),
  late: !!w.submission?.late, grade: w.submission?.assignedGrade ?? null, type: w.workType, link: w.alternateLink,
});

async function visibleCourses(t, ids, includeOld) {
  const all = await listCourses(t);
  if (ids?.length) return all.filter((c) => ids.includes(c.id));
  if (includeOld) return all;
  const hidden = new Set(defaultHidden(all));
  return all.filter((c) => !hidden.has(c.id));
}

const courseIds = { type: 'array', items: { type: 'string' }, description: 'Limit to these course ids (from list_courses). Omit for all current courses.' };

export const TOOLS = [
  {
    name: 'list_courses',
    title: 'List courses',
    description: 'List the student\'s active Google Classroom courses with their ids. Classroom keeps finished semesters marked active, so courses created 4+ months before the newest one are flagged old and left out unless include_old is true.',
    inputSchema: { type: 'object', properties: { include_old: { type: 'boolean', description: 'Include probable past-semester courses.' } } },
    annotations: { title: 'List courses', ...RO },
    async run(t, a) {
      const all = await listCourses(t);
      const old = new Set(defaultHidden(all));
      return all.filter((c) => a.include_old || !old.has(c.id)).map((c) => ({
        id: c.id, name: c.name, section: c.section || '', created: c.creationTime, old: old.has(c.id), link: c.alternateLink,
      }));
    },
  },
  {
    name: 'get_digest',
    title: 'Get digest',
    description: 'The morning digest across courses: open work bucketed overdue / next 24h / next 3 days / this week / later / no due date (next 14 days only), deadlines found in announcement text that were never set as assignments (candidates, check the quote), announcements from the last 14 days, recently posted items, and recent grades. Start here for "what\'s due" questions. Times are UTC ISO strings.',
    inputSchema: { type: 'object', properties: { course_ids: courseIds, utc_offset_minutes: { type: 'integer', description: 'Student\'s offset from UTC in minutes, e.g. 330 for India. Used to date announcement deadlines. Default 0.' } } },
    annotations: { title: 'Get digest', ...RO },
    async run(t, a) {
      const cs = await visibleCourses(t, a.course_ids);
      const full = await Promise.all(cs.map((c) => fetchCourse(t, c)));
      const p = buildPayload(full, new Date(), -(Number(a.utc_offset_minutes) || 0));
      return {
        now: p.generatedAt, courses: full.map((c) => ({ id: c.id, name: c.name })),
        open_work: p.buckets, announcement_deadlines: p.mentioned, recent_announcements: p.announcements,
        recently_posted: p.week?.courses?.map((w) => ({ course: w.code, items: w.topics })) || [], graded: p.graded.slice(0, 15),
      };
    },
  },
  {
    name: 'list_assignments',
    title: 'List assignments',
    description: 'Every published assignment in one course, with due date, points, the student\'s submission status and grade. By default only work not yet turned in.',
    inputSchema: { type: 'object', required: ['course_id'], properties: { course_id: { type: 'string' }, include_done: { type: 'boolean', description: 'Also include turned-in and returned work.' } } },
    annotations: { title: 'List assignments', ...RO },
    async run(t, a) {
      const c = await fetchCourse(t, await getCourse(t, a.course_id));
      const rows = c.coursework.filter((w) => a.include_done || !DONE.has(w.submission?.state)).map(assignmentRow);
      rows.sort((x, y) => (x.due || '9').localeCompare(y.due || '9'));
      return { course: c.name, assignments: rows };
    },
  },
  {
    name: 'get_assignment',
    title: 'Get assignment',
    description: 'One assignment in full: the instructions text, attached materials (titles and links; file contents are not available), due date, points, and the student\'s submission status and grade.',
    inputSchema: { type: 'object', required: ['course_id', 'assignment_id'], properties: { course_id: { type: 'string' }, assignment_id: { type: 'string' } } },
    annotations: { title: 'Get assignment', ...RO },
    async run(t, a) {
      const w = await getAssignment(t, a.course_id, a.assignment_id);
      return { ...assignmentRow(w), instructions: w.description || '', materials: materials(w.materials), posted: w.creationTime };
    },
  },
  {
    name: 'list_announcements',
    title: 'List announcements',
    description: 'Announcement posts, newest first, with full text and attached material links. Professors often put deadlines, exam dates and room changes here rather than in assignments.',
    inputSchema: { type: 'object', properties: { course_ids: courseIds, days: { type: 'integer', minimum: 1, maximum: 365, description: 'How far back. Default 30.' } } },
    annotations: { title: 'List announcements', ...RO },
    async run(t, a) {
      const since = Date.now() - (Number(a.days) || 30) * 864e5;
      const cs = await Promise.all((await visibleCourses(t, a.course_ids)).map((c) => fetchCourse(t, c)));
      return cs.flatMap((c) => c.announcements.map((x) => ({
        course: c.name, course_id: c.id, at: x.updateTime || x.creationTime, text: x.text || '', materials: materials(x.materials), link: x.alternateLink,
      }))).filter((x) => Date.parse(x.at || '') >= since).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 100);
    },
  },
  {
    name: 'list_materials',
    title: 'List materials',
    description: 'Course materials posted in one course (slides, readings, links), newest first, with descriptions and links. File contents are not available, only titles and links.',
    inputSchema: { type: 'object', required: ['course_id'], properties: { course_id: { type: 'string' } } },
    annotations: { title: 'List materials', ...RO },
    async run(t, a) {
      const c = await fetchCourse(t, await getCourse(t, a.course_id));
      return {
        course: c.name,
        materials: c.materials.map((m) => ({ title: m.title, description: m.description || '', posted: m.creationTime, files: materials(m.materials), link: m.alternateLink }))
          .sort((x, y) => (y.posted || '').localeCompare(x.posted || '')),
      };
    },
  },
];

export const toolList = () => TOOLS.map(({ run, ...t }) => t);


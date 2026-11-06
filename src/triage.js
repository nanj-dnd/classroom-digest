import { dueAt } from './classroom.js';
import { config } from './config.js';

const DONE = new Set(['TURNED_IN', 'RETURNED']);
const HOUR = 3600e3;

export function isOutstanding(work) {
  const s = work.submission;
  if (!s) return true;
  if (DONE.has(s.state)) return false;
  return true; // NEW, CREATED, RECLAIMED_BY_STUDENT
}

function bucketOf(due, now) {
  if (!due) return 'undated';
  const h = (due - now) / HOUR;
  if (h < 0) return 'overdue';
  if (h <= 24) return 'today';
  if (h <= 72) return 'soon';
  if (h <= 24 * 7) return 'week';
  return 'later';
}

export const BUCKET_ORDER = ['overdue', 'today', 'soon', 'week', 'later', 'undated'];

export const BUCKET_LABEL = {
  overdue: 'Overdue — not turned in',
  today: 'Due in the next 24 hours',
  soon: 'Due in the next 3 days',
  week: 'Due this week',
  later: 'On the horizon',
  undated: 'No due date set',
};

export function triage(courses, now = new Date()) {
  const horizon = now.getTime() + config.horizonDays * 24 * HOUR;
  const items = [];
  const graded = [];

  for (const c of courses) {
    for (const w of c.coursework) {
      const due = dueAt(w);
      const s = w.submission;

      if (!isOutstanding(w)) {
        // Surface work that came back with a grade — that's signal too.
        if (s?.state === 'RETURNED' && s.assignedGrade != null) {
          graded.push({
            course: c.name, title: w.title, link: w.alternateLink,
            grade: s.assignedGrade, max: w.maxPoints ?? null,
            at: s.updateTime ? new Date(s.updateTime) : null,
          });
        }
        continue;
      }

      // Don't clutter the digest with things months away.
      if (due && due.getTime() > horizon) continue;

      items.push({
        courseId: c.id,
        course: c.name,
        courseLink: c.link,
        id: w.id,
        title: w.title,
        description: w.description || '',
        link: w.alternateLink,
        points: w.maxPoints ?? null,
        workType: w.workType,
        due,
        late: !!s?.late,
        started: s?.state === 'CREATED',
        bucket: bucketOf(due, now),
      });
    }
  }

  items.sort((a, b) => {
    const d = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (d) return d;
    if (a.due && b.due && +a.due !== +b.due) return a.due - b.due;
    return (b.points ?? 0) - (a.points ?? 0);
  });

  graded.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const byBucket = new Map();
  for (const i of items) {
    if (!byBucket.has(i.bucket)) byBucket.set(i.bucket, []);
    byBucket.get(i.bucket).push(i);
  }

  return { items, byBucket, graded };
}

export function newAnnouncements(courses, state, now = new Date()) {
  const cutoff = now.getTime() - 30 * 24 * HOUR; // never resurface ancient posts
  const out = [];
  for (const c of courses) {
    const seen = new Set(state.seenAnnouncements?.[c.id] || []);
    for (const a of c.announcements) {
      if (seen.has(a.id)) continue;
      const at = a.updateTime ? new Date(a.updateTime) : null;
      if (at && at.getTime() < cutoff) continue;
      out.push({
        courseId: c.id, course: c.name, id: a.id,
        text: (a.text || '').trim(), link: a.alternateLink, at,
        attachments: (a.materials || []).length,
      });
    }
  }
  out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return out;
}

// The same ranking the CLI digest uses (src/triage.js, src/deadlines.js),
// rewritten without the local config and files so it runs in a function.

const HOUR = 3600e3;
const HORIZON_DAYS = 14;
const DONE = new Set(['TURNED_IN', 'RETURNED']);
export const ORDER = ['overdue', 'today', 'soon', 'week', 'later', 'undated'];

// Classroom gives due date and time as separate UTC parts, the time often absent.
function dueAt(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const t = w.dueTime || {};
  return new Date(Date.UTC(year, month - 1, day, t.hours ?? 23, t.minutes ?? 59, 0));
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

function triage(courses, now) {
  const horizon = now.getTime() + HORIZON_DAYS * 24 * HOUR;
  const items = [], graded = [];
  for (const c of courses) {
    for (const w of c.coursework) {
      const s = w.submission, due = dueAt(w);
      if (s && DONE.has(s.state)) {
        if (s.state === 'RETURNED' && s.assignedGrade != null) {
          graded.push({ course: c.name, title: w.title, grade: s.assignedGrade, max: w.maxPoints ?? null, at: s.updateTime || '' });
        }
        continue;
      }
      if (due && due.getTime() > horizon) continue;
      items.push({
        id: w.id, courseId: c.id, title: w.title, course: c.name, link: w.alternateLink, points: w.maxPoints ?? null,
        due, started: s?.state === 'CREATED', late: !!s?.late, bucket: bucketOf(due, now),
      });
    }
  }
  items.sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket)
    || (a.due && b.due ? a.due - b.due : 0) || (b.points ?? 0) - (a.points ?? 0));
  graded.sort((a, b) => b.at.localeCompare(a.at));
  const buckets = {};
  for (const i of items) {
    (buckets[i.bucket] ||= []).push({ ...i, due: i.due ? i.due.toISOString() : null, bucket: undefined });
  }
  return { buckets, graded };
}

// --- deadlines written in announcement prose, never set as coursework ---

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function editDistance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return m[a.length][b.length];
}

// Professors misspell months ("Setember"), so allow a small edit distance.
function monthIndex(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return -1;
  let best = -1, bestD = Infinity;
  MONTHS.forEach((m, i) => {
    const d = Math.min(editDistance(w, m), editDistance(w, m.slice(0, 3)) + (w.length > 4 ? 9 : 0));
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= 2 ? best : -1;
}

const CUE = /\b(by|due|deadline|submit|submission|before|no later than|last date)\b/i;

// `tz` is the browser's getTimezoneOffset(), so "18 September" means the
// student's 18 September, not the server's.
function detectDeadlines(courses, now, tz) {
  const year = now.getFullYear();
  const horizon = now.getTime() + HORIZON_DAYS * 24 * HOUR;
  const found = [];
  for (const c of courses) {
    for (const a of c.announcements || []) {
      const text = (a.text || '').replace(/\s+/g, ' ').trim();
      if (!text || !CUE.test(text)) continue;
      const hits = [];
      const push = (mi, day, at) => { if (mi >= 0 && day >= 1 && day <= 31) hits.push({ date: new Date(Date.UTC(year, mi, day) + tz * 60e3), at }); };
      let m;
      const r1 = /([A-Za-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
      while ((m = r1.exec(text))) push(monthIndex(m[1]), Number(m[2]), m.index);
      const r2 = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,10})\b/g;
      while ((m = r2.exec(text))) push(monthIndex(m[2]), Number(m[1]), m.index);
      for (const h of hits) {
        if (!CUE.test(text.slice(Math.max(0, h.at - 90), h.at + 40))) continue;
        if (h.date.getTime() < now.getTime() - 36 * HOUR || h.date.getTime() > horizon) continue;
        const key = `${c.id}:${a.id}:${h.date.toISOString().slice(0, 10)}`;
        if (found.some((f) => f.key === key)) continue;
        const s = text.slice(Math.max(0, h.at - 110), h.at + 60).trim();
        found.push({
          key, id: `a:${key}`, courseId: c.id, course: c.name, date: h.date.toISOString(), link: a.alternateLink,
          quote: (h.at > 110 ? '…' : '') + s + (h.at + 60 < text.length ? '…' : ''),
        });
      }
    }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date)).map(({ key, ...f }) => f);
}

// Without a syllabus, "this week" is what each course posted in the last ten days.
function recentlyPosted(courses, now) {
  const cutoff = now.getTime() - 10 * 24 * HOUR;
  const out = [];
  for (const c of courses) {
    const posts = [
      ...c.materials.map((m) => ({ text: m.title || 'Untitled material', link: m.alternateLink, at: m.creationTime })),
      ...c.coursework.map((w) => ({ text: w.title || 'Untitled assignment', link: w.alternateLink, at: w.creationTime })),
    ].filter((p) => Date.parse(p.at || '') >= cutoff).sort((a, b) => b.at.localeCompare(a.at));
    if (posts.length) out.push({ code: c.name, link: c.link, topics: posts.slice(0, 8).map(({ text, link }) => ({ text, link })), readings: [], due: [], notes: [] });
  }
  return out;
}

export function buildPayload(courses, now, tz) {
  const { buckets, graded } = triage(courses, now);
  const since = now.getTime() - 14 * 24 * HOUR;
  const announcements = courses.flatMap((c) => c.announcements
    .filter((a) => Date.parse(a.updateTime || a.creationTime || '') >= since)
    .map((a) => ({ course: c.name, text: (a.text || '').trim().slice(0, 600), link: a.alternateLink, at: a.updateTime || a.creationTime })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const recent = recentlyPosted(courses, now);
  return {
    generatedAt: now.toISOString(),
    evening: false,
    stale: null,
    week: recent.length ? { number: null, onBreak: null, from: new Date(now - 10 * 24 * HOUR).toISOString(), to: now.toISOString(), courses: recent } : null,
    classes: { today: [], tomorrow: [], upcoming: null },
    unresolved: [],
    buckets,
    mentioned: detectDeadlines(courses, now, tz),
    announcements,
    graded,
    requisites: [],
    library: [],
  };
}

// Classroom leaves finished semesters ACTIVE. Until the student picks, hide
// anything created four months or more before their newest course.
export function defaultHidden(courses) {
  const t = (c) => Date.parse(c.creationTime || '') || 0;
  const newest = Math.max(0, ...courses.map(t));
  return courses.filter((c) => newest - t(c) > 120 * 24 * HOUR).map((c) => c.id);
}

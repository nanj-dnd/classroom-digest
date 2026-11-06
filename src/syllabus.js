import fs from 'node:fs';
import path from 'node:path';
import { ROOT, aliases } from './config.js';

const FILE = path.join(ROOT, 'syllabus.json');
const DAY = 24 * 3600e3;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function loadSyllabus() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.warn(`syllabus.json is unreadable (${e.message}) — skipping outlines.`);
    return null;
  }
}

const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Monday of the week containing d.
function mondayOf(d) {
  const x = atMidnight(d);
  const shift = (x.getDay() + 6) % 7; // Sun=6, Mon=0
  return new Date(x.getTime() - shift * DAY);
}

// Content week, skipping break weeks. A break week consumes calendar time but
// no syllabus content, so week numbers after a break must not drift.
export function academicWeek(date, syl) {
  if (!syl?.termStart) return null;
  const start = mondayOf(parseDate(syl.termStart));
  const mine = mondayOf(date);
  if (mine < start) return null;

  const calendarWeeks = Math.round((mine - start) / (7 * DAY));
  let breaksPassed = 0;
  for (const b of syl.breaks || []) {
    const bMon = mondayOf(parseDate(b.from));
    if (bMon <= mine && bMon > start) breaksPassed++;
  }
  // If the date itself falls in a break week, there is no content week.
  for (const b of syl.breaks || []) {
    if (+mondayOf(parseDate(b.from)) === +mine) return { week: null, onBreak: b.name };
  }
  return { week: calendarWeeks - breaksPassed + 1, onBreak: null };
}

// On a weekend the current week is over; what matters is the one starting Monday.
function targetMonday(date) {
  const dow = date.getDay();
  const m = mondayOf(date);
  return dow === 0 || dow === 6 ? new Date(m.getTime() + 7 * DAY) : m;
}

export function weekView(date = new Date(), syl = loadSyllabus(), courses = []) {
  if (!syl) return null;
  const monday = targetMonday(date);
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const wk = academicWeek(monday, syl);

  const byCode = new Map();
  for (const c of courses) byCode.set(c.name, c);
  const findCourse = (code) => courses.find((c) => (c.fullName || c.name || '').includes(code));

  const out = [];
  for (const [code, c] of Object.entries(syl.courses || {})) {
    const live = findCourse(code);
    const entry = {
      code: aliases[code] ? `${aliases[code]} (${code})` : code,
      link: live?.link || null,
      unofficial: !!c.unofficial,
      topics: [], readings: [], due: [], notes: [],
    };

    // Courses with explicit dates: take everything inside the week.
    for (const s of c.schedule || []) {
      const d = parseDate(s.date);
      if (d < monday || d > sunday) continue;
      const label = `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
      entry.topics.push({ text: `${label}: ${s.topic}`, link: live?.link || null });
      if (s.reading) entry.readings.push(s.reading);
      if (s.due) entry.due.push(`${s.due} (due ${label})`);
      if (s.note) entry.notes.push(s.note);
    }

    // Courses numbered by week: resolve the week number to this week.
    if (c.weeks && wk?.week) {
      const w = c.weeks.find((x) => x.week === wk.week);
      if (w) {
        const pat = c.weekPattern || { A: 'Tue', B: 'Thu' };
        if (w.A) entry.topics.push({ text: `${pat.A}: ${w.A}`, link: live?.link || null });
        if (w.B) entry.topics.push({ text: `${pat.B}: ${w.B}`, link: live?.link || null });
        if (w.reading) entry.readings.push(w.reading);
      }
    }

    // Exams anywhere in the next 21 days deserve a warning, not a surprise.
    for (const e of c.exams || []) {
      if (!e.date) continue;
      const d = parseDate(e.date);
      const days = Math.round((d - atMidnight(date)) / DAY);
      if (days >= 0 && days <= 21) {
        entry.notes.push(`${e.name} in ${days} day${days === 1 ? '' : 's'} (${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}${e.time ? ', ' + e.time : ''}${e.covers ? ' — ' + e.covers : ''})`);
      }
    }

    // Standing requirements that repeat weekly, shown on the day they bite.
    for (const r of c.recurring || []) {
      if (r.day === DAYS[date.getDay()]) entry.due.push(`${r.what} by ${r.by} today`);
    }

    // A chapter spanning several sessions lists the same reading each time.
    entry.readings = [...new Set(entry.readings)];
    entry.notes = [...new Set(entry.notes)];

    // No published schedule? Show what the professor actually posted lately —
    // that is what is being covered, even without a syllabus to say so.
    if (!entry.topics.length && !entry.readings.length && live) {
      const since = new Date(monday.getTime() - 10 * DAY);
      const recent = (live.materials || [])
        .filter((m) => m.creationTime && new Date(m.creationTime) >= since)
        .sort((a, b) => new Date(b.creationTime) - new Date(a.creationTime))
        .slice(0, 5);
      for (const m of recent) {
        const when = new Date(m.creationTime);
        entry.topics.push({ text: `${DAYS[when.getDay()]} ${when.getDate()}/${when.getMonth() + 1}: ${m.title}`, link: m.alternateLink });
      }
      if (recent.length) entry.fallback = 'recently posted — no published schedule';
    }

    if (entry.topics.length || entry.readings.length || entry.due.length || entry.notes.length) {
      out.push(entry);
    }
  }

  return { monday, sunday, week: wk?.week ?? null, onBreak: wk?.onBreak ?? null, courses: out };
}

// timetable.json, syllabus.json and EXCLUDE_COURSES are all hand-maintained.
// Once the term is over they quietly describe the wrong semester, so say so.
export function staleness(now = new Date(), syl = loadSyllabus()) {
  if (!syl?.examPeriod?.to) return null;
  const end = parseDate(syl.examPeriod.to);
  if (now <= end) return null;
  const days = Math.round((now - end) / DAY);
  return `Semester data still says ${syl.term}, which ended ${days} day${days === 1 ? '' : 's'} ago. ` +
         `Refresh timetable.json, syllabus.json and EXCLUDE_COURSES in .env.`;
}

// Course-level standing requirements — things that are true all semester.
export function requisites(syl = loadSyllabus(), courses = []) {
  if (!syl) return [];
  return Object.entries(syl.courses || {})
    .filter(([, c]) => c.requisites?.length)
    .map(([code, c]) => ({
      code: aliases[code] ? `${aliases[code]} (${code})` : code,
      link: courses.find((x) => (x.fullName || x.name || '').includes(code))?.link || null,
      unofficial: !!c.unofficial,
      note: c.note || null,
      items: c.requisites,
      grading: c.grading || [],
      attendance: c.attendance || null,
    }));
}

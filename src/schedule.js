import fs from 'node:fs';
import path from 'node:path';
import { ROOT, aliases } from './config.js';

const FILE = path.join(ROOT, 'timetable.json');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Show courses the way you refer to them, not the way AMS codes them.
const label = (code) => (aliases[code] ? `${aliases[code]} (${code})` : code);

export function loadTimetable() {
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.warn(`timetable.json is unreadable (${e.message}) — skipping schedule.`);
    return null;
  }
}

const mins = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Everything on a given day, lectures and discussion sessions together,
// in the order you'll actually attend them.
export function sessionsOn(date, tt = loadTimetable()) {
  if (!tt) return [];
  const day = DAYS[date.getDay()];
  const out = [];

  for (const c of tt.courses) {
    for (const s of c.ls || []) {
      if (s.day === day) out.push({ kind: 'LS', code: label(c.code), title: c.title, faculty: c.faculty, ...s, status: c.lsStatus });
    }
    if (c.ds?.slot?.day === day) {
      out.push({
        kind: 'DS', code: label(c.code), title: c.title,
        faculty: [c.ds.faculty], ...c.ds.slot, status: c.ds.status, section: c.ds.section,
      });
    }
  }
  out.sort((a, b) => mins(a.start) - mins(b.start));
  return out;
}

// A DS you never got a seat in is a standing problem, not a daily one —
// surface it until it resolves.
export function unresolvedRegistrations(tt = loadTimetable()) {
  if (!tt) return [];
  return tt.courses
    .filter((c) => c.ds && c.ds.status && c.ds.status.toLowerCase() !== 'confirmed')
    .map((c) => ({ code: label(c.code), status: c.ds.status, slot: c.ds.slot, faculty: c.ds.faculty }));
}

// On a weekend "nothing today" is useless; say when you're next in a room.
export function nextSessionDay(from, tt = loadTimetable()) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from.getTime() + i * 24 * 3600e3);
    const s = sessionsOn(d, tt);
    if (s.length) return { date: d, sessions: s };
  }
  return null;
}

export function describe(s) {
  return `${s.start}–${s.end}  ${s.kind}  ${s.code}`;
}

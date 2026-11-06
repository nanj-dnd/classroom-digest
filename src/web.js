import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { requisites } from './syllabus.js';
import { library, loadManifest } from './library.js';

const WEB = path.join(ROOT, 'web');

// The dashboard is a static snapshot: the data is baked in at generation time.
// Nothing on the host can reach Classroom, so no Google token ever leaves this Mac.
const noAiTitles = () => new Set(loadManifest().filter((e) => e.noAI).map((e) => e.title));

export function buildPayload({ byBucket, items, graded, announcements, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, courses, stale, now }) {
  return {
    generatedAt: now.toISOString(),
    evening: !!evening,
    stale: stale || null,
    anchor: (anchor || now).toISOString(),
    week: week ? { number: week.week, onBreak: week.onBreak, from: week.monday.toISOString(), to: week.sunday.toISOString(), courses: week.courses } : null,
    classes: { today: today || [], tomorrow: tomorrow || [], upcoming: upcoming ? { date: upcoming.date.toISOString(), sessions: upcoming.sessions } : null },
    unresolved: unresolved || [],
    buckets: (() => { const locked = noAiTitles(); return Object.fromEntries([...byBucket].map(([k, v]) => [k, v.map((i) => ({
      noAI: locked.has(i.title),
      title: i.title, course: i.course, link: i.link, points: i.points,
      due: i.due ? i.due.toISOString() : null, started: !!i.started, late: !!i.late,
    }))])); })(),
    mentioned: (mentioned || []).map((m) => ({ course: m.course, date: m.date.toISOString(), quote: m.quote, link: m.link })),
    announcements: (announcements || []).map((a) => ({ course: a.course, text: a.text.slice(0, 400), link: a.link, at: a.at ? a.at.toISOString() : null })),
    graded: (graded || []).map((g) => ({ course: g.course, title: g.title, grade: g.grade, max: g.max })),
    requisites: requisites(undefined, courses || []),
    library: library(),
  };
}

export function writeSite(payload) {
  fs.mkdirSync(path.join(WEB, 'public'), { recursive: true });
  fs.mkdirSync(path.join(WEB, 'api'), { recursive: true });
  const tpl = fs.readFileSync(path.join(WEB, 'template.html'), 'utf8');

  // Local preview copy — plain file, no auth, never deployed (see .vercelignore).
  fs.writeFileSync(path.join(WEB, 'public', 'preview.html'), tpl.replace('/*__DATA__*/null', JSON.stringify(payload)));

  // Deployed copies live as modules the serverless function imports, so the
  // coursework is never a statically served file.
  fs.writeFileSync(path.join(WEB, 'api', '_payload.js'), `export const PAYLOAD = ${JSON.stringify(payload)};\n`);
  fs.writeFileSync(path.join(WEB, 'api', '_template.js'), `export const TEMPLATE = ${JSON.stringify(tpl)};\n`);

  return path.join(WEB, 'public', 'preview.html');
}

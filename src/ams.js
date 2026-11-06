import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT } from './config.js';

// AMS is ASP.NET WebForms, so element ids are generated and unstable. Find the
// table by its header text instead — that survives markup churn.
const WANT = ['course', 'ls', 'ls faculty', 'ls timing', 'ds'];

function findTable($) {
  let best = null;
  $('table').each((_, el) => {
    const heads = $(el).find('tr').first().find('th,td').map((__, c) => $(c).text().trim().toLowerCase()).get();
    const hits = WANT.filter((w) => heads.includes(w)).length;
    if (hits >= 4 && (!best || hits > best.hits)) best = { el, heads, hits };
  });
  return best;
}

const clean = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "Mon-(15:00-16:30), Wed-(15:00-16:30)" -> [{day,start,end}, ...]
// AMS lists slots in arbitrary order; sort so the data is canonical.
export function parseTiming(raw) {
  const out = [];
  const re = /([A-Za-z]{3})[^\(]*\((\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\)/g;
  let m;
  while ((m = re.exec(raw || ''))) {
    out.push({ day: m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase(), start: m[2], end: m[3] });
  }
  out.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.start.localeCompare(b.start));
  return out;
}

// "[ECO-2101] - Microeconomic Theory I" -> { code, title }
export function parseCourse(raw) {
  const m = clean(raw).match(/^\[([^\]]+)\]\s*[-–]\s*(.*)$/);
  return m ? { code: clean(m[1]), title: clean(m[2]) } : { code: clean(raw), title: clean(raw) };
}

// Faculty arrive as separate lines/<br>; split on newlines, not commas —
// names themselves contain commas in some listings.
function parseFaculty($, cell) {
  const html = $(cell).html() || '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => clean(cheerio.load('<x>' + s + '</x>')('x').text()))
    .filter(Boolean);
}

export function parseAmsHtml(html, term = 'Unknown term') {
  const $ = cheerio.load(html);
  const found = findTable($);
  if (!found) {
    throw new Error(
      'No DS Registration table found. Expected a table with Course / LS / LS Faculty / LS Timing / DS headers.\n' +
      'Make sure you saved the page *after* the table rendered (Cmd+S -> "Web Page, Complete").'
    );
  }

  const idx = {};
  found.heads.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });

  const courses = [];
  $(found.el).find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 5) return;
    const at = (name) => (idx[name] != null ? cells.eq(idx[name]) : null);
    const txt = (name) => clean(at(name)?.text() || '');

    const { code, title } = parseCourse(txt('course'));
    if (!code) return;

    const dsTiming = parseTiming(txt('ds timing'));
    const dsSection = txt('ds');
    courses.push({
      code, title,
      classroomName: code,
      section: txt('ls'),
      faculty: at('ls faculty') ? parseFaculty($, at('ls faculty')) : [],
      lsStatus: txt('ls status') || 'Unknown',
      ls: parseTiming(txt('ls timing')),
      ds: dsSection
        ? {
            section: dsSection,
            faculty: txt('ds faculty'),
            status: txt('ds status') || 'Unknown',
            slot: dsTiming[0] || null,
          }
        : null,
    });
  });

  if (!courses.length) throw new Error('Found the table but parsed zero courses — the row layout may have changed.');
  return { term, note: `Parsed from a saved AMS DS Registration page on ${new Date().toDateString()}.`, courses };
}

export function importAms(file, term) {
  if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); return false; }
  const tt = parseAmsHtml(fs.readFileSync(file, 'utf8'), term);
  const dest = path.join(ROOT, 'timetable.json');

  if (fs.existsSync(dest)) {
    const backup = dest + '.bak';
    fs.copyFileSync(dest, backup);
    console.log(`Previous timetable backed up to ${path.basename(backup)}`);
  }
  fs.writeFileSync(dest, JSON.stringify(tt, null, 2));

  console.log(`\nParsed ${tt.courses.length} course(s):`);
  for (const c of tt.courses) {
    const ls = c.ls.map((s) => `${s.day} ${s.start}`).join(', ') || 'no LS times';
    const ds = c.ds?.slot ? `DS ${c.ds.slot.day} ${c.ds.slot.start} [${c.ds.status}]` : 'no DS';
    console.log(`  ${c.code.padEnd(12)} ${ls.padEnd(28)} ${ds}`);
  }
  console.log(`\nWrote ${dest}`);
  return true;
}

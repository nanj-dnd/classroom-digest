import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Professors misspell months ("Setember"). Allow one edit so a typo doesn't
// hide a real deadline.
function editDistance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return m[a.length][b.length];
}

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

// "September 08", "18 September", "Sept 8th"
function findDates(text, year) {
  const out = [];
  const push = (mi, day, idx) => {
    if (mi < 0 || !day || day < 1 || day > 31) return;
    out.push({ date: new Date(year, mi, day), at: idx });
  };
  let m;
  const a = /([A-Za-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
  while ((m = a.exec(text))) push(monthIndex(m[1]), Number(m[2]), m.index);
  const b = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,10})\b/g;
  while ((m = b.exec(text))) push(monthIndex(m[2]), Number(m[1]), m.index);
  return out;
}

const CUE = /\b(by|due|deadline|submit|submission|before|no later than|last date)\b/i;

// Deadlines announced in prose are invisible to courseWork.list, so scan the
// announcement text as well. Everything found is a CANDIDATE, never a fact.
export function detectDeadlines(courses, now = new Date()) {
  const year = now.getFullYear();
  const horizon = now.getTime() + config.horizonDays * 24 * 3600e3;
  const ignored = loadOverrides().ignore || [];
  const found = [];

  for (const c of courses) {
    for (const a of c.announcements || []) {
      const text = (a.text || '').replace(/\s+/g, ' ').trim();
      if (!text || !CUE.test(text)) continue;

      for (const hit of findDates(text, year)) {
        // Only count a date that sits near deadline language.
        const window = text.slice(Math.max(0, hit.at - 90), hit.at + 40);
        if (!CUE.test(window)) continue;
        if (hit.date.getTime() < now.getTime() - 12 * 3600e3) continue;
        if (hit.date.getTime() > horizon) continue;

        const key = `${c.id}:${a.id}:${hit.date.toISOString().slice(0, 10)}`;
        if (ignored.includes(key)) continue;
        if (found.some((f) => f.key === key)) continue;

        const s = text.slice(Math.max(0, hit.at - 110), hit.at + 60).trim();
        found.push({
          key, course: c.name, date: hit.date, link: a.alternateLink,
          quote: (hit.at > 110 ? '…' : '') + s + (hit.at + 60 < text.length ? '…' : ''),
        });
      }
    }
  }
  found.sort((a, b) => a.date - b.date);
  return found;
}

function loadOverrides() {
  const f = path.join(ROOT, 'deadlines.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
}

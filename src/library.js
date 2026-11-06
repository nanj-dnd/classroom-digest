import fs from 'node:fs';
import path from 'node:path';
import { COURSES_DIR } from './config.js';

const MANIFEST = path.join(COURSES_DIR, 'manifest.json');

export function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return [];
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return []; }
}

// Grouped by course, newest first, for the dashboard's Library section.
export function library() {
  const byCourse = new Map();
  for (const e of loadManifest()) {
    if (!byCourse.has(e.course)) byCourse.set(e.course, { course: e.course, link: e.courseLink, items: [] });
    byCourse.get(e.course).items.push({
      kind: e.kind, title: e.title, link: e.link, noAI: !!e.noAI,
      when: e.due || e.posted || null,
      dir: e.dir,
      files: (e.files || []).map((f) => ({ name: f.name, path: f.path, kb: Math.round(f.bytes / 1024), text: f.text })),
    });
  }
  for (const c of byCourse.values()) {
    c.items.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  }
  return [...byCourse.values()];
}

// Search the extracted text of the whole corpus.
export function search(query, limit = 20) {
  const q = query.toLowerCase();
  const hits = [];

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      const st = fs.statSync(f);
      if (st.isDirectory()) { walk(f); continue; }
      if (!/\.(txt|md)$/i.test(name)) continue;
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const lower = text.toLowerCase();
      let i = lower.indexOf(q);
      while (i !== -1 && hits.length < limit) {
        hits.push({
          file: path.relative(COURSES_DIR, f),
          context: text.slice(Math.max(0, i - 110), i + 150).replace(/\s+/g, ' ').trim(),
        });
        i = lower.indexOf(q, i + q.length);
        break; // one hit per file keeps results readable
      }
      if (hits.length >= limit) return;
    }
  };

  if (fs.existsSync(COURSES_DIR)) walk(COURSES_DIR);
  return hits;
}

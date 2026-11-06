import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { COURSES_DIR } from './config.js';
import { dueAt } from './classroom.js';

const slug = (s) =>
  (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

// Google-native files can't be downloaded raw; they have to be exported.
const EXPORT_AS = {
  'application/vnd.google-apps.document': ['text/markdown', 'md'],
  'application/vnd.google-apps.presentation': ['application/pdf', 'pdf'],
  'application/vnd.google-apps.spreadsheet': ['text/csv', 'csv'],
  'application/vnd.google-apps.drawing': ['image/png', 'png'],
};

// PDFs are the main format professors post in, and a PDF on disk is not
// searchable. Extract a .txt sidecar so the corpus can be grepped and read.
export const needsOcr = [];
export const restricted = [];

// Some courses forbid putting the problems into an AI system at all, and make
// you sign a declaration saying you did not. Detect that BEFORE anything reads
// the file, and mark the folder loudly.
const NO_AI = [
  /not put these problems into an ai/i,
  /have not read ai-generated text/i,
  /declaration of originality/i,
  /prohibited from[\s\S]{0,400}ai system/i,
  /using an ai system to write, rewrite/i,
];

function checkRestricted(text) {
  return NO_AI.filter((re) => re.test(text)).length >= 2;
}

async function extractPdfText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, '.txt');
  if (fs.existsSync(txtPath)) return;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const buf = new Uint8Array(fs.readFileSync(pdfPath));
    // verbosity 0 silences pdfjs font warnings ("TT: undefined function").
    const pdf = await getDocumentProxy(buf, { verbosity: 0 });
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    if (text?.trim()) {
      fs.writeFileSync(txtPath, `<!-- extracted from ${path.basename(pdfPath)}, ${totalPages} page(s) -->\n\n${text}`);
    } else {
      // A scan with no text layer. Record it rather than failing silently —
      // otherwise it looks synced but is invisible to search.
      needsOcr.push({ file: pdfPath, pages: totalPages });
      fs.writeFileSync(txtPath.replace(/\.txt$/, '.NO-TEXT-LAYER.md'),
        `This PDF is a scan with no extractable text (${totalPages} pages).\n` +
        `It needs OCR before it can be searched or quoted.\n`);
    }
  } catch (e) {
    needsOcr.push({ file: pdfPath, error: e.message });
    console.warn(`    (could not read ${path.basename(pdfPath)}: ${e.message})`);
  }
}

async function downloadFile(drive, fileId, destDir) {
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const { name, mimeType } = meta.data;
  const exp = EXPORT_AS[mimeType];
  const safe = String(name || fileId).replace(/[\/\\]/g, '-');
  const dest = path.join(destDir, exp ? `${slug(name)}.${exp[1]}` : safe);

  if (!fs.existsSync(dest)) {
    const res = exp
      ? await drive.files.export({ fileId, mimeType: exp[0] }, { responseType: 'stream' })
      : await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      res.data.on('error', reject).pipe(out).on('finish', resolve).on('error', reject);
    });
  }
  if (/\.pdf$/i.test(dest)) await extractPdfText(dest);
  return path.basename(dest);
}

// Render any Classroom material list to markdown links, downloading what we can.
async function materialLines(drive, materials, dir) {
  const lines = [];
  let count = 0;
  for (const m of materials || []) {
    if (m.driveFile?.driveFile?.id) {
      const t = m.driveFile.driveFile.title;
      try {
        const f = await downloadFile(drive, m.driveFile.driveFile.id, dir);
        lines.push(`- [${t}](./${encodeURI(f)})`);
        count++;
      } catch (e) {
        lines.push(`- ${t} — could not download (${e.message})`);
      }
    } else if (m.link) lines.push(`- [${m.link.title || m.link.url}](${m.link.url})`);
    else if (m.youtubeVideo) lines.push(`- YouTube: [${m.youtubeVideo.title}](${m.youtubeVideo.alternateLink})`);
    else if (m.form) lines.push(`- Form: [${m.form.title || 'form'}](${m.form.formUrl})`);
  }
  return { lines, count };
}

export async function syncMaterials(auth, courses, items) {
  const drive = google.drive({ version: 'v3', auth });
  const manifest = [];
  const wanted = new Set(items.map((i) => `${i.courseId}:${i.id}`));
  let files = 0, folders = 0;

  for (const c of courses) {
    const cdir = path.join(COURSES_DIR, slug(c.baseName || c.name));

    // 1. Outstanding assignments: the brief plus its attachments.
    for (const w of c.coursework) {
      if (!wanted.has(`${c.id}:${w.id}`)) continue;
      const dir = path.join(cdir, 'assignments', slug(w.title));
      fs.mkdirSync(dir, { recursive: true });
      folders++;

      const due = dueAt(w);
      const { lines, count } = await materialLines(drive, w.materials, dir);
      files += count;

      // Scan the attachments' extracted text for an AI prohibition.
      let locked = false;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.txt$/i.test(f)) continue;
        let t = '';
        try { t = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 12000); } catch { continue; }
        if (checkRestricted(t)) { locked = true; break; }
      }
      if (locked) {
        restricted.push({ course: c.name, title: w.title, dir: path.relative(COURSES_DIR, dir) });
        fs.writeFileSync(path.join(dir, 'DO-NOT-FEED-TO-AI.md'),
          `# ${w.title} — ${c.name}\n\n` +
          `This assignment's own guidelines prohibit putting its problems into an AI system,\n` +
          `and require a signed declaration that you did not.\n\n` +
          `Do not open the problem pages in an AI session. Do not paste, screenshot, describe\n` +
          `or reword them. Asking "what kind of problem is this" or "is my answer right" counts.\n\n` +
          `What the course does allow: asking an AI to explain a definition, a method, or a\n` +
          `point in the chapter you did not follow, or to set you a DIFFERENT practice problem\n` +
          `you did not build out of this one.\n`);
      }

      manifest.push({ course: c.name, courseLink: c.link, kind: 'assignment', title: w.title,
        link: w.alternateLink, dir: path.relative(COURSES_DIR, dir), noAI: locked,
        due: due ? due.toISOString() : null, points: w.maxPoints ?? null });

      fs.writeFileSync(path.join(dir, 'brief.md'), [
        `# ${w.title}`, '',
        `- Course: ${c.name}`,
        `- Due: ${due ? due.toString() : 'no due date'}`,
        `- Points: ${w.maxPoints ?? 'ungraded'}`,
        `- Classroom: ${w.alternateLink}`,
        '', '## Brief', '',
        w.description?.trim() || '_No description given._',
        ...(lines.length ? ['', '## Materials', '', ...lines] : []),
      ].join('\n') + '\n');
    }

    // 2. Course materials — readings and slides, which the old version ignored.
    for (const m of c.materials || []) {
      const dir = path.join(cdir, 'materials', slug(m.title));
      fs.mkdirSync(dir, { recursive: true });
      folders++;
      const { lines, count } = await materialLines(drive, m.materials, dir);
      files += count;
      manifest.push({ course: c.name, courseLink: c.link, kind: 'material', title: m.title,
        link: m.alternateLink, dir: path.relative(COURSES_DIR, dir),
        posted: m.creationTime || null });

      fs.writeFileSync(path.join(dir, 'about.md'), [
        `# ${m.title}`, '',
        `- Course: ${c.name}`,
        `- Posted: ${m.creationTime || 'unknown'}`,
        `- Classroom: ${m.alternateLink}`,
        '', m.description?.trim() || '', ...(lines.length ? ['', '## Files', '', ...lines] : []),
      ].join('\n') + '\n');
    }

    // 3. Announcements, with their attachments — often where the real
    //    instructions live ("how to submit", "DS schedule changed").
    if (c.announcements?.length) {
      const adir = path.join(cdir, 'announcements');
      fs.mkdirSync(adir, { recursive: true });
      const out = [`# ${c.name} — announcements`, ''];
      for (const a of c.announcements) {
        const { lines, count } = await materialLines(drive, a.materials, adir);
        files += count;
        out.push(`## ${a.creationTime ? new Date(a.creationTime).toDateString() : 'undated'}`, '',
          (a.text || '').trim() || '_(no text)_', '', ...(lines.length ? [...lines, ''] : []),
          `[open in Classroom](${a.alternateLink})`, '', '---', '');
      }
      fs.writeFileSync(path.join(cdir, 'announcements.md'), out.join('\n'));
    }
  }

  // A manifest of everything on disk, so files can be listed and referenced
  // without re-walking Drive.
  for (const entry of manifest) {
    const abs = path.join(COURSES_DIR, entry.dir);
    entry.files = fs.existsSync(abs)
      ? fs.readdirSync(abs).filter((f) => !/^(brief|about)\.md$/.test(f)).map((f) => {
          const st = fs.statSync(path.join(abs, f));
          return { name: f, path: path.join(entry.dir, f), bytes: st.size,
                   text: /\.(txt|md|csv)$/i.test(f) };
        })
      : [];
  }
  fs.writeFileSync(path.join(COURSES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  writeIndex(courses);
  return { files, folders };
}

// A single entry point into the corpus, so context is one file away.
function writeIndex(courses) {
  const out = ['# Course corpus', '', `_Synced ${new Date().toString()}_`, ''];
  for (const c of courses) {
    const d = slug(c.baseName || c.name);
    out.push(`## ${c.name}`, '');
    out.push(`- Classroom: ${c.link}`);
    out.push(`- Folder: \`courses/${d}/\``);
    if (c.announcements?.length) out.push(`- [Announcements](./${d}/announcements.md) (${c.announcements.length})`);
    if (c.materials?.length) out.push(`- Materials: ${c.materials.map((m) => m.title).join(', ')}`);
    if (c.coursework?.length) out.push(`- Assignments: ${c.coursework.map((w) => w.title).join(', ')}`);
    out.push('');
  }
  if (needsOcr.length) {
    out.push('## Scans with no text layer', '',
      'These are downloaded but not searchable — they need OCR before they can be quoted:', '');
    for (const n of needsOcr) {
      out.push(`- \`${path.relative(COURSES_DIR, n.file)}\`${n.pages ? ` (${n.pages} pages)` : ''}${n.error ? ` — ${n.error}` : ''}`);
    }
    out.push('');
  }
  fs.writeFileSync(path.join(COURSES_DIR, 'INDEX.md'), out.join('\n'));
}

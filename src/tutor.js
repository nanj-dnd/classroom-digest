import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config, ROOT, COURSES_DIR } from './config.js';
import { loadManifest } from './library.js';

// Three study actions over the synced course files, on the student's own key:
//   quiz — quiz me on one file (slides, a reading, a past paper)
//   prep — prepare me for a course's next test
//   help — help me with an assignment, as a tutor, never as a ghostwriter

const MAX_PDF_BYTES = 20 * 1024 * 1024;
// Roughly 100k tokens of course text for test prep. Anything past it is listed
// to the model and to the student by name, never silently dropped.
const PREP_CHAR_BUDGET = 400_000;

const SYSTEM = {
  quiz: `You are a study tutor inside a student's college tracker. The student wants to be quizzed on the course file attached to their first message.

Ask ONE question at a time and wait for their answer. After each answer, say whether it was right, explain why in two or three sentences, then ask the next question. Mix recall, application and "explain it in your own words" questions, and get harder as they get things right. If they name a slide or page ("slide 12", "page 4"), quiz only on that part. Quote the file when you correct them, so they can find the spot. After about eight questions, or when they ask, give a short summary of what they know and what to revise.`,

  prep: `You are a study tutor inside a student's college tracker, preparing the student for their next test in one course. Their syllabus details, announcements and course files are attached.

Start with:
1. Which test is next, when, and what it covers, taken from the syllabus and announcements. If the material doesn't say, say so plainly and ask the student rather than guessing.
2. The topics that matter most, ranked, each tied to the file where it's taught.
3. A day-by-day revision plan from today to the test that fits around their other deadlines if they mention them.
4. An offer to quiz them, topic by topic.

Then keep tutoring: quiz, explain, and set fresh practice problems in the style of any past papers attached.`,

  help: `You are a tutor inside a student's college tracker, helping with the assignment attached to their first message.

Help the way a good teaching assistant does in office hours. Explain the concepts the assignment uses, point to where the course files teach them, break the task into steps, and ask the student to try each step. Give feedback on their own attempts and drafts: say what is wrong and why, and give hints, without rewriting it for them.

Do not write the assignment for them. That means no complete answers, essays, solutions or code they could hand in, even when asked directly, rephrased, or split into pieces. If they ask you to just do it, say briefly that you'll help them do it themselves, and give the next concrete step. Practice problems that are different from the assigned ones, with full worked solutions, are fine.`,
};

const EFFORT = { quiz: 'medium', prep: 'high', help: 'medium' };

const OPENERS = {
  quiz: 'Quiz me on this.',
  prep: 'Prepare me for my next test in this course.',
  help: 'Help me get started on this assignment.',
};

const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function within(base, rel) {
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path outside the course folder.');
  return abs;
}

// A file is off limits if its entry is flagged, or its folder carries the
// marker the sync writes for courses that forbid AI.
function flagged(entry) {
  return !!entry?.noAI || fs.existsSync(path.join(COURSES_DIR, entry?.dir || '', 'DO-NOT-FEED-TO-AI.md'));
}

// A course that forbids AI on one assignment almost always means all of them,
// and the detector only catches the ones whose files spell it out. So one
// flagged assignment locks every assignment in that course.
function forbidden(entry, manifest = loadManifest()) {
  if (flagged(entry)) return true;
  return entry?.kind === 'assignment' && manifest.some((e) => e.course === entry.course && e.kind === 'assignment' && flagged(e));
}

// Refused on purpose (an AI-prohibited assignment), as opposed to broken.
class Blocked extends Error {}

const textBlock = (title, body) => ({ type: 'text', text: `<file name="${title}">\n${body}\n</file>` });

function readText(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; }
}

// A PDF goes in as a document so Claude sees the slides themselves, diagrams
// and all, and scans with no text layer still work. Anything else goes as text.
function fileBlock(rel) {
  const abs = within(COURSES_DIR, rel);
  const name = path.basename(rel);
  if (/\.pdf$/i.test(rel) && fs.statSync(abs).size <= MAX_PDF_BYTES) {
    return { type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(abs).toString('base64') } };
  }
  const sidecar = abs.replace(/\.pdf$/i, '.txt');
  const text = /\.(txt|md|csv)$/i.test(abs) ? readText(abs) : readText(sidecar);
  if (!text.trim()) throw new Error(`${name} has no readable text, and is too large to send as a PDF.`);
  return textBlock(name, text);
}

// The files worth reading in an entry: prefer the original over its .txt
// sidecar, since a PDF sidecar would just duplicate it.
function primaryFiles(entry) {
  const names = new Set((entry.files || []).map((f) => f.name));
  return (entry.files || []).filter((f) => {
    if (/\.NO-TEXT-LAYER\.md$|^DO-NOT-FEED-TO-AI\.md$/i.test(f.name)) return false;
    if (/\.txt$/i.test(f.name) && names.has(f.name.replace(/\.txt$/i, '.pdf'))) return false;
    return true;
  });
}

function quizContext({ file }) {
  const entry = loadManifest().find((e) => (e.files || []).some((f) => f.path === file));
  if (!entry) throw new Error('That file is not in the synced library. Sync, then try again.');
  if (forbidden(entry)) throw new Blocked(`"${entry.title}" is marked as not allowing AI, so the study buttons are off for it.`);
  return { label: `${entry.course} · ${path.basename(file)}`, blocks: [fileBlock(file)] };
}

function helpContext({ link }) {
  const manifest = loadManifest();
  const entry = manifest.find((e) => e.kind === 'assignment' && e.link === link);
  if (!entry) throw new Error('This assignment has no synced brief yet. Sync, then try again.');
  if (forbidden(entry, manifest)) throw new Blocked(`${entry.course} doesn't allow AI on its assignments, so AI help is off here. Ask your professor or TA instead.`);
  const blocks = [];
  const brief = path.join(COURSES_DIR, entry.dir, 'brief.md');
  if (fs.existsSync(brief)) blocks.push(textBlock('brief.md', readText(brief)));
  for (const f of primaryFiles(entry)) {
    try { blocks.push(fileBlock(f.path)); } catch (e) { blocks.push({ type: 'text', text: `(Could not attach ${f.name}: ${e.message})` }); }
  }
  if (!blocks.length) throw new Error('This assignment has no brief or files synced.');
  return { label: `${entry.course} · ${entry.title}`, blocks };
}

function syllabusFor(course) {
  try {
    const syl = JSON.parse(fs.readFileSync(path.join(ROOT, 'syllabus.json'), 'utf8'));
    const key = Object.keys(syl.courses || {}).find((k) => course.includes(k));
    if (!key) return null;
    const { term, termStart, examPeriod, breaks, holidays } = syl;
    return { term, termStart, examPeriod, breaks, holidays, course: { code: key, ...syl.courses[key] } };
  } catch { return null; }
}

function prepContext({ course }) {
  const manifest = loadManifest();
  const entries = manifest.filter((e) => e.course === course);
  if (!entries.length) throw new Error('No synced files for this course yet. Sync, then try again.');
  const blocks = [];

  const syl = syllabusFor(course);
  blocks.push(syl
    ? textBlock('syllabus.json (this course)', JSON.stringify(syl, null, 1))
    : { type: 'text', text: '(No syllabus.json entry for this course. Find test dates and topics in the announcements and files.)' });

  const dir = entries[0].dir.split('/')[0];
  const ann = path.join(COURSES_DIR, dir, 'announcements.md');
  if (fs.existsSync(ann)) blocks.push(textBlock('announcements.md', readText(ann)));

  // Newest material first: the next test is almost always on recent weeks.
  const files = entries
    .filter((e) => !forbidden(e, manifest))
    .sort((a, b) => (b.due || b.posted || '').localeCompare(a.due || a.posted || ''))
    .flatMap((e) => primaryFiles(e).map((f) => ({ ...f, from: e.title })));

  let used = 0;
  const left = [];
  for (const f of files) {
    const abs = within(COURSES_DIR, f.path);
    const text = /\.(txt|md|csv)$/i.test(f.name) ? readText(abs) : readText(abs.replace(/\.[^.]+$/, '.txt'));
    if (!text.trim()) { left.push(`${f.name} (no text layer)`); continue; }
    if (used + text.length > PREP_CHAR_BUDGET) { left.push(f.name); continue; }
    used += text.length;
    blocks.push(textBlock(`${f.from} / ${f.name}`, text));
  }
  if (left.length) {
    blocks.push({ type: 'text', text: `(Not attached, to keep this affordable: ${left.join('; ')}. Mention this if those files look relevant.)` });
  }
  return { label: `${course} · test prep`, blocks, omitted: left };
}

const BUILD = { quiz: quizContext, prep: prepContext, help: helpContext };

// Stream one turn. `history` is everything after the opening message: the
// assistant turns exactly as the API returned them, and the student's replies.
// `emit` gets {t:'text'} chunks, then {t:'done', content} or {t:'error'}.
export async function chat({ action, target, history = [], emit }) {
  if (!SYSTEM[action]) throw new Error(`Unknown action: ${action}`);
  if (!config.anthropicKey) { emit({ t: 'error', v: 'Add your Claude API key in Settings first.', needKey: true }); return; }

  let ctx;
  try { ctx = BUILD[action](target || {}); } catch (e) { emit({ t: 'error', v: e.message, blocked: e instanceof Blocked }); return; }

  // The opening message is rebuilt identically every turn, so its files stay
  // in the prompt cache and each follow-up costs a fraction of the first.
  const opening = {
    role: 'user',
    content: [...ctx.blocks, { type: 'text', text: `Today is ${today()}.\n\n${OPENERS[action]}`, cache_control: { type: 'ephemeral' } }],
  };

  const client = new Anthropic({ apiKey: config.anthropicKey });
  try {
    const stream = client.beta.messages.stream({
      model: config.claudeModel,
      max_tokens: 64000,
      system: SYSTEM[action],
      output_config: { effort: EFFORT[action] },
      // On a safety decline, the API reruns the turn on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [opening, ...history],
    });
    stream.on('text', (v) => emit({ t: 'text', v }));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') emit({ t: 'text', v: '\n\n_(Claude declined to continue this one.)_' });
    if (msg.stop_reason === 'max_tokens') emit({ t: 'text', v: '\n\n_(Cut off at the length limit.)_' });
    emit({ t: 'done', content: msg.content });
  } catch (e) {
    let v = e.message;
    if (e instanceof Anthropic.AuthenticationError) v = 'Your Claude API key was rejected. Check it in Settings.';
    else if (e instanceof Anthropic.PermissionDeniedError) v = 'Your Claude API key cannot use this model.';
    else if (e instanceof Anthropic.RateLimitError) v = 'Rate limited by the Claude API. Wait a minute and try again.';
    else if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) v = 'Your Claude account is out of credit. Top it up at console.anthropic.com.';
    else if (e instanceof Anthropic.APIConnectionError) v = 'Could not reach the Claude API. Check your connection.';
    emit({ t: 'error', v });
  }
}

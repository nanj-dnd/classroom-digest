import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const COURSES_DIR = path.join(ROOT, 'courses');

const ENV_FILE = path.join(ROOT, '.env');

// Minimal .env loader — no dependency, no surprises.
function loadEnv() {
  const f = ENV_FILE;
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const bool = (v, d) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));

export const config = {
  digestTo: process.env.DIGEST_TO || '',
  resendKey: process.env.RESEND_API_KEY || '',
  digestFrom: process.env.DIGEST_FROM || '',
  syncDrive: bool(process.env.SYNC_DRIVE, true),
  syncCalendar: bool(process.env.SYNC_CALENDAR, true),
  calendarName: process.env.CALENDAR_NAME || 'College',
  horizonDays: Number(process.env.HORIZON_DAYS || 14),
  // Run at or after this hour and the digest describes TOMORROW, not today.
  eveningAfterHour: Number(process.env.EVENING_AFTER_HOUR || 18),
  autoDeploy: bool(process.env.AUTO_DEPLOY, false),
  // Classroom leaves finished semesters marked ACTIVE; filter them by name.
  excludeCourses: (process.env.EXCLUDE_COURSES || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // email | whatsapp | both | none
  channel: (process.env.DIGEST_CHANNEL || 'email').toLowerCase(),
  waToken: process.env.WA_TOKEN || '',
  waPhoneId: process.env.WA_PHONE_ID || '',
  waTo: process.env.WA_TO || '',
  waTemplate: process.env.WA_TEMPLATE || 'college_digest',
  waLang: process.env.WA_LANG || 'en',

  // The study buttons. Each student brings their own key.
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
  appPort: Number(process.env.APP_PORT || 8420),
};

// Write one KEY=value into .env (the app's settings page), and apply it live.
export function setEnv(key, value) {
  const clean = String(value ?? '').replace(/[\r\n]/g, '').trim();
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const i = lines.findIndex((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1] === key);
  while (lines.at(-1) === '') lines.pop();
  if (i >= 0) lines[i] = `${key}=${clean}`; else lines.push(`${key}=${clean}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
  process.env[key] = clean;
}

// Course codes are how AMS names things; aliases are how you think of them.
export const aliases = (() => {
  const f = path.join(ROOT, 'aliases.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
})();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(COURSES_DIR, { recursive: true });

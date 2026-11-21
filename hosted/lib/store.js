import crypto from 'node:crypto';
import { put, get, del, list } from '@vercel/blob';
import { seal, unseal } from './session.js';

// One private, encrypted blob per student, keyed by an HMAC of their Google
// account id so the pathname reveals nothing. It holds their settings, and
// their Google sign-in only while email reminders are switched on.

const DIR = 'users/';
const keyOf = (sub) => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(`user:${sub}`).digest('hex').slice(0, 40);
const pathOf = (key) => `${DIR}${key}.bin`;

export const DEFAULT_REMINDERS = {
  on: false,
  days: [0, 1, 2, 3, 4, 5, 6],
  hour: 21,
  include: { overdue: true, today: true, soon: true, week: true, later: false, undated: false, mentioned: true, announcements: true, grades: true },
  skipEmpty: true,
};

export const PRIORITIES = ['deadlines', 'mentioned', 'announcements', 'grades', 'plan', 'claude'];

export function blank(sub, email) {
  return { sub, email, tz: 'Asia/Kolkata', hiddenCourses: null, hiddenTasks: [], reminders: structuredClone(DEFAULT_REMINDERS), priorities: [], onboarded: false, rt: null, lastSent: null };
}

async function readBody(res) {
  const chunks = [];
  for await (const c of res.stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

export async function loadByKey(key) {
  try {
    const r = await get(pathOf(key), { access: 'private', useCache: false });
    if (!r) return null;
    const doc = unseal(await readBody(r));
    return doc ? { ...doc, key } : null;
  } catch (e) {
    if (e?.name === 'BlobNotFoundError') return null;
    throw e;
  }
}

export const load = (sub) => loadByKey(keyOf(sub));

export async function loadOrBlank(sub, email) {
  const doc = (await load(sub)) || blank(sub, email);
  if (email && doc.email !== email) doc.email = email;
  return { ...doc, key: keyOf(sub) };
}

export async function save(doc) {
  const { key, ...body } = doc;
  body.updatedAt = new Date().toISOString();
  await put(pathOf(key || keyOf(doc.sub)), seal(body), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/octet-stream', cacheControlMaxAge: 60,
  });
}

export async function remove(sub) {
  try { await del(pathOf(keyOf(sub))); } catch (e) { if (e?.name !== 'BlobNotFoundError') throw e; }
}

// Every stored student, for the reminder job.
export async function allKeys() {
  const keys = [];
  let cursor;
  do {
    const r = await list({ prefix: DIR, cursor, limit: 1000 });
    for (const b of r.blobs) keys.push(b.pathname.slice(DIR.length).replace(/\.bin$/, ''));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return keys;
}

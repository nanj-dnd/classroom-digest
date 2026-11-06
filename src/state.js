import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'state.json');
const EMPTY = { seenAnnouncements: {}, calendarEvents: {}, lastDigestAt: null };

export function loadState() {
  if (!fs.existsSync(FILE)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    console.warn('state.json was unreadable; starting fresh.');
    return { ...EMPTY };
  }
}

export function saveState(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function markAnnouncementsSeen(state, courses) {
  for (const c of courses) {
    state.seenAnnouncements[c.id] = c.announcements.map((a) => a.id);
  }
}

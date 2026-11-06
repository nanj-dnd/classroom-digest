import { google } from 'googleapis';
import { config } from './config.js';

// Keep deadlines on their own calendar so they sit beside your meetings but can
// be hidden or deleted wholesale without touching anything else.
async function ensureCalendar(cal) {
  const list = await cal.calendarList.list({ maxResults: 250 });
  const found = (list.data.items || []).find((c) => c.summary === config.calendarName);
  if (found) return found.id;

  const made = await cal.calendars.insert({
    requestBody: { summary: config.calendarName, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  console.log(`Created calendar "${config.calendarName}".`);
  return made.data.id;
}

export async function syncCalendar(auth, items, state) {
  const cal = google.calendar({ version: 'v3', auth });
  const calendarId = await ensureCalendar(cal);

  const live = new Set();
  let created = 0, updated = 0, removed = 0;

  for (const i of items) {
    if (!i.due) continue;
    const key = `${i.courseId}:${i.id}`;
    live.add(key);

    const start = new Date(i.due.getTime() - 30 * 60e3);
    const body = {
      summary: `${i.title} — ${i.course}`,
      description: `${i.link}\n\n${(i.description || '').slice(0, 800)}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: i.due.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 60 }] },
      extendedProperties: { private: { classroomKey: key } },
    };

    const existing = state.calendarEvents[key];
    try {
      if (existing) {
        await cal.events.update({ calendarId, eventId: existing, requestBody: body });
        updated++;
      } else {
        const res = await cal.events.insert({ calendarId, requestBody: body });
        state.calendarEvents[key] = res.data.id;
        created++;
      }
    } catch (e) {
      if (existing && (e.code === 404 || e.code === 410)) {
        delete state.calendarEvents[key]; // event was deleted by hand; recreate next run
      } else {
        console.warn(`  ! calendar "${i.title}": ${e.message}`);
      }
    }
  }

  // Anything no longer outstanding has been turned in — clear it off the calendar.
  for (const [key, eventId] of Object.entries(state.calendarEvents)) {
    if (live.has(key)) continue;
    try {
      await cal.events.delete({ calendarId, eventId });
      removed++;
    } catch (e) {
      if (e.code !== 404 && e.code !== 410) console.warn(`  ! calendar cleanup: ${e.message}`);
    }
    delete state.calendarEvents[key];
  }

  return { created, updated, removed };
}

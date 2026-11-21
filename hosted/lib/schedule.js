import { zoneOffset } from './load.js';

// Local date, weekday and hour for a student's time zone.
export function localNow(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, day, hour: +p.hour };
}

// The daily job runs once in each UTC hour. A student's email belongs to the
// run whose UTC hour contains their chosen local time, so a 9pm choice in
// India (15:30 UTC) goes out with the 15:00 UTC run, between 8:30 and 9:30pm.
export function dueNow(doc, now = new Date()) {
  const r = doc.reminders;
  if (!r?.on || !doc.rt || !doc.email) return false;
  const off = zoneOffset(doc.tz, now);              // UTC − local, minutes
  const utcHour = (((Math.floor((r.hour * 60 + off) / 60)) % 24) + 24) % 24;
  if (utcHour !== now.getUTCHours()) return false;
  const local = localNow(doc.tz, now);
  if (!r.days.includes(local.day)) return false;
  return doc.lastSent !== local.date;
}

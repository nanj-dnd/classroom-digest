#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { config, DATA_DIR } from './config.js';
import { authorize, getClient } from './auth.js';
import { fetchEverything } from './classroom.js';
import { triage, newAnnouncements } from './triage.js';
import { loadState, saveState, markAnnouncementsSeen } from './state.js';
import { syncMaterials, needsOcr, restricted } from './drive.js';
import { syncCalendar } from './calendar.js';
import { renderHtml, renderText } from './digest.js';
import { sendDigest } from './mail.js';
import { sendWhatsApp, whatsappParams } from './whatsapp.js';
import { doctor, dump } from './doctor.js';
import { sessionsOn, unresolvedRegistrations, nextSessionDay } from './schedule.js';
import { weekView, requisites, staleness } from './syllabus.js';
import { detectDeadlines } from './deadlines.js';
import { buildPayload, writeSite } from './web.js';
import { search } from './library.js';
import { deploy } from './deploy.js';
import { notifyFailure } from './notify.js';
import { adopt } from './adopt.js';
import { importAms } from './ams.js';

const CACHE = path.join(DATA_DIR, 'snapshot.json');

async function pull() {
  const auth = await getClient();
  const courses = await fetchEverything(auth);
  fs.writeFileSync(CACHE, JSON.stringify({ at: new Date(), courses }, null, 2));
  return { auth, courses };
}

async function run({ send, dry }) {
  const now = new Date();
  const state = loadState();
  const { auth, courses } = await pull();

  const { byBucket, items, graded } = triage(courses, now);
  const announcements = newAnnouncements(courses, state, now);
  // A 22:00 digest is about tomorrow morning; a 07:30 one is about today.
  const evening = now.getHours() >= config.eveningAfterHour;
  const anchor = evening ? new Date(now.getTime() + 24 * 3600e3) : now;

  const today = sessionsOn(anchor);
  const tomorrow = sessionsOn(new Date(anchor.getTime() + 24 * 3600e3));
  const unresolved = unresolvedRegistrations();
  const upcoming = !today.length && !tomorrow.length ? nextSessionDay(anchor) : null;
  const week = weekView(anchor, undefined, courses);
  const stale = staleness(now);
  if (stale) console.warn(`\n! ${stale}\n`);
  const mentioned = detectDeadlines(courses, now);

  let materialsInfo = null;
  if (config.syncDrive && !dry) {
    console.log('Syncing briefs and attachments...');
    materialsInfo = await syncMaterials(auth, courses, items);
    console.log(`  ${materialsInfo.folders} folder(s), ${materialsInfo.files} file(s).`);
    for (const r of restricted) console.log(`  ⚠ ${r.title} (${r.course}) prohibits AI use — marked DO-NOT-FEED-TO-AI.md`);
    if (needsOcr.length) console.log(`  ${needsOcr.length} PDF(s) have no text layer (scans) — listed in courses/INDEX.md`);
  }

  if (config.syncCalendar && !dry) {
    console.log('Syncing calendar...');
    const r = await syncCalendar(auth, items, state);
    console.log(`  +${r.created} ~${r.updated} -${r.removed}`);
  }

  // Static dashboard snapshot, regenerated on every run.
  try {
    const payload = buildPayload({ byBucket, items, graded, announcements, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, courses, stale, now });
    // The local app reads this one; the deployed site reads web/api/_payload.js.
    fs.writeFileSync(path.join(DATA_DIR, 'payload.json'), JSON.stringify(payload));
    const file = writeSite(payload);
    console.log(`Dashboard written to ${file}`);
  } catch (e) {
    console.warn(`Could not build dashboard: ${e.message}`);
  }

  const html = renderHtml({ byBucket, graded, announcements, materialsInfo, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, courses, stale, now });
  const overdue = (byBucket.get('overdue') || []).length;
  const dueToday = (byBucket.get('today') || []).length;
  const when = evening ? 'tomorrow' : 'today';
  const subject = overdue
    ? `${overdue} overdue · ${items.length} open`
    : dueToday ? `${dueToday} due ${when} · ${items.length} open`
    : items.length ? `${items.length} open, nothing urgent` : 'All clear';

  console.log('\n' + renderText({ byBucket, announcements, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, courses, stale, now }));

  if (dry) {
    const out = path.join(DATA_DIR, 'preview.html');
    fs.writeFileSync(out, html);
    if (config.channel === 'whatsapp' || config.channel === 'both') {
    const wp = whatsappParams({ byBucket, items, today, tomorrow, upcoming, announcements, unresolved });
    console.log('WhatsApp template parameters:');
    wp.forEach((v, i) => console.log(`  {{${i + 1}}} ${v}`));
    const bad = wp.filter((v) => /[\r\n\t]/.test(v) || /\s{4,}/.test(v) || v.length > 1024);
    console.log(bad.length ? `  !! ${bad.length} param(s) would be REJECTED by Meta` : '  (all params valid for Meta)');
    }
    console.log(`\nPreview written to ${out} — nothing sent, no calendar or Drive writes, nothing marked seen.`);
    return;
  }

  if (send) {
    const ch = config.channel;
    if (ch === 'email' || ch === 'both') await sendDigest({ subject: `College · ${subject}`, html });
    if (ch === 'whatsapp' || ch === 'both') {
      await sendWhatsApp(whatsappParams({ byBucket, items, today, tomorrow, upcoming, announcements, unresolved }));
    }
    if (ch === 'none') console.log('DIGEST_CHANNEL=none — nothing sent.');
  }

  // The site is a build artifact — regenerating the payload does nothing until
  // it is deployed, so the nightly run pushes it too.
  if (config.autoDeploy) {
    try {
      const r = await deploy();
      console.log(r.skipped ? `Deploy skipped: ${r.skipped}` : `Deployed${r.url ? ' ' + r.url : ''}`);
    } catch (e) {
      console.error(`Deploy failed: ${e.message}`);
      await notifyFailure(e, 'deploy step');
    }
  }

  // Only mark things seen once the digest actually went out.
  markAnnouncementsSeen(state, courses);
  state.lastDigestAt = now.toISOString();
  saveState(state);
}

const cmd = process.argv[2] || 'run';
const flags = new Set(process.argv.slice(3));

try {
  if (cmd === 'app' || cmd === 'start') await (await import('./app.js')).startApp();
  else if (cmd === 'auth') await authorize();
  else if (cmd === 'timetable') {
    const file = process.argv[3];
    if (!file) { console.log('usage: college timetable <saved-ams-page.html> ["Term Name"]'); process.exit(1); }
    if (!importAms(file, process.argv[4] || 'Unknown term')) process.exit(1);
  }
  else if (cmd === 'requisites' || cmd === 'outline') {
    const rs = requisites();
    if (!rs.length) console.log('No syllabus.json, or no requisites recorded.');
    for (const r of rs) {
      console.log(`\n${r.code}`);
      if (r.grading.length) {
        console.log('  Grading:');
        for (const g of r.grading) console.log(`    ${String(g.weight).padEnd(24)} ${g.what}`);
      }
      if (r.attendance) console.log(`  Attendance: ${r.attendance}`);
      console.log('  Must do:');
      for (const i of r.items) console.log(`    - ${i}`);
    }
    console.log('');
  }
  else if (cmd === 'find' || cmd === 'search') {
    const q = process.argv.slice(3).join(' ');
    if (!q) { console.log('usage: college find <text>'); process.exit(1); }
    const hits = search(q);
    if (!hits.length) console.log(`Nothing matching "${q}" in the synced corpus.`);
    for (const h of hits) console.log(`\n${h.file}\n   …${h.context}…`);
    console.log('');
  }
  else if (cmd === 'adopt') { if (!adopt(process.argv[3])) process.exit(1); }
  else if (cmd === 'doctor' || cmd === 'check') { if (!(await doctor(getClient))) process.exit(1); }
  else if (cmd === 'dump') await dump(getClient);
  else if (cmd === 'sync') await run({ send: false, dry: false });
  else if (cmd === 'digest' || cmd === 'run') await run({ send: !flags.has('--dry'), dry: flags.has('--dry') });
  else {
    console.log('usage: college [app|adopt|doctor|auth|timetable <file.html>|requisites|find <text>|sync|dump|digest [--dry]]');
    process.exit(1);
  }
} catch (e) {
  console.error('\n' + (e?.message || e));
  // A cron that dies quietly is the worst failure mode this tool has.
  if (cmd === 'digest' || cmd === 'run' || cmd === 'sync') await notifyFailure(e, `\`${cmd}\` command`);
  process.exit(1);
}

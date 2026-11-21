import crypto from 'node:crypto';
import { allKeys, loadByKey, save } from '../lib/store.js';
import { refresh } from '../lib/google.js';
import { loadDigest, zoneOffset } from '../lib/load.js';
import { compose, send } from '../lib/email.js';
import { dueNow, localNow } from '../lib/schedule.js';
import { json } from '../lib/http.js';

// Runs once in each UTC hour (vercel.json crons). Sends to every student
// whose chosen local time falls in this hour and who hasn't had today's.
export default async function handler(req, res) {
  const want = `Bearer ${process.env.CRON_SECRET || ''}`;
  const got = String(req.headers.authorization || '');
  if (!process.env.CRON_SECRET || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return json(res, 401, { error: 'unauthorized' });

  const now = new Date();
  const base = `https://${process.env.PUBLIC_HOST || req.headers.host}`;
  const stats = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const keys = await allKeys();
  const run = async (key) => {
    stats.checked++;
    const doc = await loadByKey(key);
    if (!doc || !dueNow(doc, now)) return;
    try {
      let at;
      try { at = (await refresh(doc.rt)).access_token; }
      catch (e) {
        // Access revoked at Google: stop trying until they turn it back on.
        if (e.code === 'invalid_grant') { doc.reminders.on = false; doc.rt = null; await save(doc); }
        throw e;
      }
      const p = await loadDigest(at, doc, zoneOffset(doc.tz, now));
      const since = doc.lastSentAt ? Date.parse(doc.lastSentAt) : now - 864e5;
      const mail = compose(p, doc, { since, base });
      doc.lastSent = localNow(doc.tz, now).date;
      if (mail.empty && doc.reminders.skipEmpty) { stats.skipped++; await save(doc); return; }
      await send(doc.email, mail);
      doc.lastSentAt = now.toISOString();
      await save(doc);
      stats.sent++;
    } catch (e) { stats.failed++; console.error('reminder', key.slice(0, 8), e.message); }
  };
  for (let i = 0; i < keys.length; i += 8) await Promise.all(keys.slice(i, i + 8).map(run));
  console.log('cron', now.toISOString(), stats);
  json(res, 200, stats);
}

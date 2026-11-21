import { open } from '../lib/oauth.js';
import { loadByKey, save } from '../lib/store.js';
import { html, json, message } from '../lib/http.js';

// The link in every reminder, and mail clients' one-click unsubscribe (POST).
export default async function handler(req, res) {
  const t = open('unsub', String(req.query.t || ''));
  const done = (ok) => req.method === 'POST' ? json(res, ok ? 200 : 400, { ok })
    : html(res, ok ? message('Emails turned off', 'You will not get any more reminder emails. Turn them back on any time in Settings on Classroom Digest.')
      : message('Link not valid', 'This unsubscribe link is not valid. Turn reminders off in Settings on Classroom Digest.'), ok ? 200 : 400);
  if (!t) return done(false);
  try {
    const doc = await loadByKey(t.key);
    if (doc?.reminders?.on) { doc.reminders.on = false; doc.rt = null; await save(doc); }
    done(true);
  } catch (e) { console.error('unsubscribe', e.message); done(false); }
}

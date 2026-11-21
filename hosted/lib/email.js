import { ORDER } from './digest.js';
import { issue } from './oauth.js';

// The reminder email: only the sections the student ticked, newest-relevant
// first, plain enough to read on a phone lock screen.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { overdue: 'Overdue', today: 'Due in the next 24 hours', soon: 'Due in the next 3 days', week: 'Due this week', later: 'Later', undated: 'No due date' };
const TONE = { overdue: '#b42318', today: '#b54708', soon: '#93370d', week: '#175cd3', later: '#475467', undated: '#475467' };

function when(iso, tz) {
  if (!iso) return 'no due date';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function compose(p, doc, { since, base }) {
  const inc = doc.reminders.include, tz = doc.tz;
  const buckets = ORDER.filter((b) => inc[b] && p.buckets[b]?.length).map((b) => [b, p.buckets[b]]);
  const mentioned = inc.mentioned ? p.mentioned : [];
  const announcements = inc.announcements ? p.announcements.filter((a) => Date.parse(a.at) > since).slice(0, 10) : [];
  const grades = inc.grades ? p.graded.filter((g) => Date.parse(g.at) > since).slice(0, 10) : [];
  const empty = !buckets.length && !mentioned.length && !announcements.length && !grades.length;

  const n = (b) => (p.buckets[b] || []).length;
  const subject = n('overdue') ? `${n('overdue')} overdue${n('today') ? `, ${n('today')} due in 24h` : ''}`
    : n('today') ? `${n('today')} due in the next 24 hours`
    : n('soon') ? `${n('soon')} due in the next 3 days`
    : n('week') ? `${n('week')} due this week`
    : announcements.length ? `${announcements.length} new announcement${announcements.length > 1 ? 's' : ''}`
    : 'Nothing due soon';

  const unsub = `${base}/api/unsubscribe?t=${encodeURIComponent(issue('unsub', { key: doc.key }))}`;
  const h = [], t = [];
  const section = (title, color = '#101828') => {
    h.push(`<div style="margin:26px 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${color}">${esc(title)}</div>`);
    t.push('', title.toUpperCase());
  };
  h.push(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px 20px;color:#101828;background:#fff;line-height:1.45">`);
  h.push(`<div style="font-size:22px;font-weight:650;margin:0 0 4px">${esc(subject)}</div>`);
  h.push(`<div style="font-size:13px;color:#667085">${esc(new Date().toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }))}</div>`);
  t.push(subject);

  for (const [b, list] of buckets) {
    section(LABEL[b], TONE[b]);
    for (const i of list) {
      h.push(`<div style="padding:8px 0;border-top:1px solid #eaecf0"><a href="${esc(i.link)}" style="color:#101828;font-weight:600;font-size:15px;text-decoration:none">${esc(i.title)}</a>` +
        `<div style="font-size:13px;color:#667085;margin-top:2px">${esc(i.course)} · ${esc(when(i.due, tz))}${i.points ? ` · ${esc(i.points)} pts` : ''}</div></div>`);
      t.push(`- ${i.title} [${i.course}] ${when(i.due, tz)}`);
    }
  }
  if (mentioned.length) {
    section('Dates mentioned in announcements', '#b54708');
    for (const m of mentioned) {
      h.push(`<div style="padding:8px 0;border-top:1px solid #eaecf0"><div style="font-weight:600;font-size:14px">${esc(m.course)} · ${esc(new Date(m.date).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }))}</div>` +
        `<div style="font-size:13px;color:#667085;margin-top:2px">${esc(m.quote)}</div><a href="${esc(m.link)}" style="font-size:13px;color:#175cd3">Open announcement</a></div>`);
      t.push(`- ${m.course} ${m.date.slice(0, 10)}: ${m.quote}`);
    }
  }
  if (announcements.length) {
    section('New announcements');
    for (const a of announcements) {
      const s = a.text.replace(/\s+/g, ' ');
      h.push(`<div style="padding:8px 0;border-top:1px solid #eaecf0"><div style="font-size:12px;color:#667085">${esc(a.course)}</div>` +
        `<a href="${esc(a.link)}" style="color:#101828;font-size:14px;text-decoration:none">${esc(s.slice(0, 220))}${s.length > 220 ? '…' : ''}</a></div>`);
      t.push(`- [${a.course}] ${s.slice(0, 140)}`);
    }
  }
  if (grades.length) {
    section('New grades');
    for (const g of grades) {
      h.push(`<div style="padding:7px 0;border-top:1px solid #eaecf0;font-size:14px">${esc(g.title)} <span style="color:#667085">· ${esc(g.course)}</span> <b>${esc(g.grade)}${g.max ? '/' + esc(g.max) : ''}</b></div>`);
      t.push(`- ${g.title} [${g.course}] ${g.grade}${g.max ? '/' + g.max : ''}`);
    }
  }
  if (empty) { h.push('<p style="font-size:14px;color:#667085;margin-top:20px">Nothing in the sections you chose.</p>'); t.push('', 'Nothing in the sections you chose.'); }

  h.push(`<div style="margin-top:32px;padding-top:12px;border-top:1px solid #eaecf0;font-size:12px;color:#98a2b3">` +
    `<a href="${base}" style="color:#98a2b3">Open Classroom Digest</a> · <a href="${base}/#settings" style="color:#98a2b3">Change what you get</a> · <a href="${esc(unsub)}" style="color:#98a2b3">Turn off these emails</a></div></div>`);
  t.push('', `Open: ${base}`, `Change what you get: ${base}/#settings`, `Turn off: ${unsub}`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head><body style="margin:0;background:#fff">${h.join('')}</body></html>`;
  return { subject, html, text: t.join('\n'), empty, unsub };
}

export async function send(to, mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Classroom Digest <digest@anshul-anand.com>',
      to: [to], subject: mail.subject, html: mail.html, text: mail.text,
      headers: { 'List-Unsubscribe': `<${mail.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  // Resend reports failures in the body, not by throwing; check every time.
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`Resend refused the email: ${j.message || r.status}`);
  return j.id;
}

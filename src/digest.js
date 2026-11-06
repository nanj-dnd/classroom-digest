import { BUCKET_ORDER, BUCKET_LABEL } from './triage.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TONE = {
  overdue: '#b42318',
  today:   '#b54708',
  soon:    '#854a0e',
  week:    '#175cd3',
  later:   '#475467',
  undated: '#475467',
};

function when(due, now) {
  if (!due) return 'no due date';
  const h = (due - now) / 3600e3;
  const day = due.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (h < 0) {
    const d = Math.floor(-h / 24);
    return d >= 1 ? `${d} day${d > 1 ? 's' : ''} overdue — was ${day}` : `${Math.floor(-h)}h overdue — was ${day} ${time}`;
  }
  if (h <= 24) return `in ${Math.max(1, Math.round(h))}h — ${day} ${time}`;
  return `${day}, ${time}`;
}

export function renderHtml({ byBucket, graded, announcements, materialsInfo, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, stale, now = new Date() }) {
  const total = [...byBucket.values()].reduce((n, a) => n + a.length, 0);
  const overdue = (byBucket.get('overdue') || []).length;
  const dueToday = (byBucket.get('today') || []).length;

  const p = [];
  p.push(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;background:#fff">`);
  p.push(`<div style="font-size:13px;color:#667085;letter-spacing:.04em;text-transform:uppercase">${esc(now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>`);

  const headline = overdue
    ? `${overdue} overdue, ${total} open`
    : dueToday ? `${dueToday} due ${evening ? 'tomorrow' : 'today'}, ${total} open`
    : total ? `${total} open, nothing urgent` : `Nothing outstanding`;
  p.push(`<h1 style="font-size:26px;margin:6px 0 20px;font-weight:650">${esc(headline)}</h1>`);

  // Your day, before the backlog — what you have to physically show up to.
  const sessionRow = (x) =>
    `<div style="display:flex;gap:10px;padding:5px 0;font-size:14px">` +
      `<span style="color:#667085;font-variant-numeric:tabular-nums;min-width:96px">${esc(x.start)}–${esc(x.end)}</span>` +
      `<span style="font-weight:600">${esc(x.code)}</span>` +
      `<span style="color:#667085">${esc(x.kind)}${x.status && x.status !== 'Confirmed' ? ' · ' + esc(x.status) : ''}</span>` +
    `</div>`;

  if (upcoming) {
    const label = upcoming.date.toLocaleDateString(undefined, { weekday: 'long' });
    p.push(`<div style="margin:20px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#101828">Next classes — ${esc(label)}</div>`);
    p.push(upcoming.sessions.map(sessionRow).join(''));
  } else if (today?.length || tomorrow?.length) {
    p.push(`<div style="margin:20px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#101828">${evening ? 'Tomorrow' : 'Today'}</div>`);
    p.push(today?.length ? today.map(sessionRow).join('') : `<div style="font-size:14px;color:#667085">No classes.</div>`);
    if (tomorrow?.length) {
      p.push(`<div style="margin:16px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#667085">${evening ? 'The day after' : 'Tomorrow'}</div>`);
      p.push(tomorrow.map(sessionRow).join(''));
    }
  }

  if (unresolved?.length) {
    for (const u of unresolved) {
      p.push(`<div style="margin:14px 0;padding:10px 12px;background:#fffaeb;border-left:3px solid #b54708;border-radius:4px;font-size:13px;color:#7a2e0e">` +
        `DS registration for <b>${esc(u.code)}</b> is still <b>${esc(u.status)}</b> (${esc(u.slot.day)} ${esc(u.slot.start)}–${esc(u.slot.end)}, ${esc(u.faculty)}).</div>`);
    }
  }

  // What the syllabus says you should have read before walking in.
  if (week?.courses?.length) {
    const label = week.onBreak
      ? esc(week.onBreak)
      : `Week ${week.week} · ${week.monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${week.sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    p.push(`<div style="margin:26px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#101828">This week — ${label}</div>`);
    for (const c of week.courses) {
      p.push(`<div style="margin:0 0 14px;padding:10px 12px;background:#f9fafb;border-radius:6px">`);
      p.push(c.link
        ? `<div style="font-size:14px;font-weight:650;margin-bottom:4px"><a href="${esc(c.link)}" style="color:#101828;text-decoration:none">${esc(c.code)}</a></div>`
        : `<div style="font-size:14px;font-weight:650;margin-bottom:4px">${esc(c.code)}</div>`);
      if (c.fallback) p.push(`<div style="font-size:12px;color:#98a2b3;margin-bottom:3px">${esc(c.fallback)}</div>`);
      if (c.unofficial) p.push(`<div style="font-size:12px;color:#b54708;margin-bottom:3px">No syllabus posted — from announcements only.</div>`);
      for (const t of c.topics) {
        const txt = typeof t === 'string' ? t : t.text;
        const lnk = typeof t === 'string' ? null : t.link;
        p.push(lnk
          ? `<div style="font-size:13px"><a href="${esc(lnk)}" style="color:#475467">${esc(txt)}</a></div>`
          : `<div style="font-size:13px;color:#475467">${esc(txt)}</div>`);
      }
      for (const r of c.readings) p.push(`<div style="font-size:13px;margin-top:4px"><b>Read:</b> ${esc(r)}</div>`);
      for (const d of c.due) p.push(`<div style="font-size:13px;margin-top:4px;color:#b54708"><b>Due:</b> ${esc(d)}</div>`);
      for (const n of c.notes) p.push(`<div style="font-size:13px;margin-top:4px;color:#b42318">${esc(n)}</div>`);
      p.push(`</div>`);
    }
  }

  if (stale) p.push(`<div style="margin:14px 0;padding:10px 12px;background:#fef3f2;border-left:3px solid #b42318;border-radius:4px;font-size:13px;color:#912018">${esc(stale)}</div>`);

  for (const b of BUCKET_ORDER) {
    const list = byBucket.get(b);
    if (!list?.length) continue;
    p.push(`<div style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${TONE[b]}">${esc(BUCKET_LABEL[b])}</div>`);
    for (const i of list) {
      p.push(
        `<div style="border-left:3px solid ${TONE[b]};padding:8px 0 8px 12px;margin:0 0 10px">` +
          `<a href="${esc(i.link)}" style="font-size:15px;font-weight:600;color:#101828;text-decoration:none">${esc(i.title)}</a>` +
          `<div style="font-size:13px;color:#667085;margin-top:3px">` +
            `${esc(i.course)} &middot; ${esc(when(i.due, now))}` +
            (i.points ? ` &middot; ${esc(i.points)} pts` : '') +
            (i.started ? ` &middot; <span style="color:#175cd3">draft started</span>` : '') +
          `</div>` +
        `</div>`
      );
    }
  }

  // Deadlines stated in prose rather than created as Classroom assignments.
  // These are guesses from text, so they are shown with their source quote.
  if (mentioned?.length) {
    p.push(`<div style="margin:26px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b54708">Mentioned in announcements — not Classroom assignments</div>`);
    for (const m of mentioned) {
      const days = Math.round((m.date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
      p.push(`<div style="margin:0 0 10px;padding:9px 12px;background:#fffaeb;border-left:3px solid #b54708;border-radius:4px">` +
        `<div style="font-size:14px;font-weight:600">${esc(m.course)} — ${esc(m.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}` +
        `<span style="font-weight:400;color:#7a2e0e"> (${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'})</span></div>` +
        `<div style="font-size:12px;color:#7a2e0e;margin-top:3px">${esc(m.quote)}</div>` +
        `<a href="${esc(m.link)}" style="font-size:12px;color:#b54708">open announcement</a></div>`);
    }
  }

  if (announcements?.length) {
    p.push(`<div style="margin:28px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475467">New since last digest</div>`);
    for (const a of announcements.slice(0, 12)) {
      const snippet = a.text.replace(/\s+/g, ' ').slice(0, 200);
      p.push(
        `<div style="padding:8px 0;border-bottom:1px solid #eaecf0">` +
          `<div style="font-size:12px;color:#667085">${esc(a.course)}${a.at ? ' &middot; ' + esc(a.at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : ''}</div>` +
          `<a href="${esc(a.link)}" style="font-size:14px;color:#101828;text-decoration:none">${esc(snippet)}${a.text.length > 200 ? '…' : ''}</a>` +
          (a.attachments ? `<div style="font-size:12px;color:#667085">${a.attachments} attachment(s)</div>` : '') +
        `</div>`
      );
    }
  }

  if (graded?.length) {
    p.push(`<div style="margin:28px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475467">Recently graded</div>`);
    for (const g of graded.slice(0, 6)) {
      p.push(`<div style="font-size:14px;padding:4px 0">${esc(g.title)} <span style="color:#667085">— ${esc(g.course)}</span> <b>${esc(g.grade)}${g.max ? '/' + esc(g.max) : ''}</b></div>`);
    }
  }

  if (materialsInfo?.folders) {
    p.push(`<div style="margin-top:28px;padding:12px;background:#f9fafb;border-radius:8px;font-size:13px;color:#475467">Briefs and attachments for ${materialsInfo.folders} assignment(s) are synced to <code>~/Downloads/classroom-digest/courses/</code>${materialsInfo.files ? ` (${materialsInfo.files} file(s))` : ''}.</div>`);
  }

  p.push(`</div>`);
  return p.join('');
}

export function renderText({ byBucket, announcements, today, tomorrow, upcoming, unresolved, week, mentioned, evening, anchor, now = new Date() }) {
  const out = [];
  if (upcoming) {
    out.push(`NEXT CLASSES — ${upcoming.date.toLocaleDateString(undefined, { weekday: 'long' })}`);
    for (const x of upcoming.sessions) out.push(`  ${x.start}-${x.end}  ${x.kind}  ${x.code}${x.status !== 'Confirmed' ? ' [' + x.status + ']' : ''}`);
  } else if (today?.length || tomorrow?.length) {
    out.push(evening ? 'TOMORROW' : 'TODAY');
    for (const x of today || []) out.push(`  ${x.start}-${x.end}  ${x.kind}  ${x.code}${x.status !== 'Confirmed' ? ' [' + x.status + ']' : ''}`);
    if (!today?.length) out.push('  (no classes)');
    if (tomorrow?.length) {
      out.push('', evening ? 'THE DAY AFTER' : 'TOMORROW');
      for (const x of tomorrow) out.push(`  ${x.start}-${x.end}  ${x.kind}  ${x.code}${x.status !== 'Confirmed' ? ' [' + x.status + ']' : ''}`);
    }
  }
  for (const u of unresolved || []) out.push('', `! DS for ${u.code} still ${u.status} (${u.slot.day} ${u.slot.start})`);
  if (week?.courses?.length) {
    out.push('', `THIS WEEK — ${week.onBreak || 'Week ' + week.week}`);
    for (const c of week.courses) {
      out.push(`  ${c.code}${c.fallback ? ' — ' + c.fallback : ''}${c.unofficial ? ' [no syllabus posted]' : ''}`);
      for (const t of c.topics) out.push(`    ${typeof t === 'string' ? t : t.text}`);
      for (const r of c.readings) out.push(`    READ: ${r}`);
      for (const d of c.due) out.push(`    DUE: ${d}`);
      for (const n of c.notes) out.push(`    ! ${n}`);
    }
  }
  for (const b of BUCKET_ORDER) {
    const list = byBucket.get(b);
    if (!list?.length) continue;
    out.push('', BUCKET_LABEL[b].toUpperCase());
    for (const i of list) out.push(`  ${i.title}  [${i.course}]  ${when(i.due, now)}`);
  }
  if (mentioned?.length) {
    out.push('', 'MENTIONED IN ANNOUNCEMENTS (not Classroom assignments)');
    for (const m of mentioned) out.push(`  ${m.date.toDateString()}  ${m.course}`);
  }
  if (announcements?.length) {
    out.push('', `NEW ANNOUNCEMENTS (${announcements.length})`);
    for (const a of announcements.slice(0, 10)) out.push(`  [${a.course}] ${a.text.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  return (out.join('\n').trim() || 'Nothing outstanding.') + '\n';
}

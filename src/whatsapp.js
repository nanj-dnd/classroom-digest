import { config } from './config.js';

// WhatsApp template parameters may not contain newlines, tabs, or runs of 4+
// spaces. Meta rejects the whole send if they do, so sanitise every value.
export function safeParam(s, max = 900) {
  const out = String(s ?? '')
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return (out.length > max ? out.slice(0, max - 1) + '…' : out) || '—';
}

// Build the four values the template expects. Structure lives in the approved
// template; only these values are injected.
export function whatsappParams({ byBucket, items, today, tomorrow, upcoming, announcements, unresolved }) {
  const overdue = (byBucket.get('overdue') || []).length;
  const dueToday = (byBucket.get('today') || []).length;
  const headline = overdue
    ? `${overdue} overdue, ${items.length} open`
    : dueToday ? `${dueToday} due today, ${items.length} open`
    : items.length ? `${items.length} open, nothing urgent` : 'nothing outstanding';

  const sessions = today?.length ? today : upcoming?.sessions || [];
  const when = today?.length ? '' : upcoming ? `${upcoming.date.toLocaleDateString(undefined, { weekday: 'short' })}: ` : '';
  const classes = sessions.length
    ? when + sessions.map((s) => `${s.code} ${s.start}`).join(', ')
    : 'no classes';

  const next = (items || [])
    .filter((i) => i.due)
    .slice(0, 3)
    .map((i) => `${i.title} (${i.course}) ${i.due.toLocaleDateString(undefined, { weekday: 'short' })} ${i.due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`)
    .join('; ') || 'nothing dated';

  const extra = [
    announcements?.length ? `${announcements.length} new post${announcements.length > 1 ? 's' : ''}` : null,
    ...(unresolved || []).map((u) => `${u.code} DS ${u.status}`),
  ].filter(Boolean).join('; ') || 'nothing new';

  return [headline, classes, next, extra].map((v) => safeParam(v));
}

export async function sendWhatsApp(params) {
  const { waToken, waPhoneId, waTo, waTemplate, waLang } = config;
  if (!waToken || !waPhoneId || !waTo || !waTemplate) {
    console.log('WhatsApp not configured (WA_TOKEN / WA_PHONE_ID / WA_TO / WA_TEMPLATE) — skipping.');
    return false;
  }

  const body = {
    messaging_product: 'whatsapp',
    to: waTo,
    type: 'template',
    template: {
      name: waTemplate,
      language: { code: waLang },
      components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
    },
  };

  const res = await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    // Meta returns 200-with-error in some cases; check both.
    const e = json.error || {};
    console.error(`WhatsApp send failed (${res.status}): ${e.message || JSON.stringify(json)}`);
    if (e.code === 132000) console.error('  -> parameter count does not match the template.');
    if (e.code === 132001) console.error('  -> template name/language not found or not approved yet.');
    if (e.code === 131047) console.error('  -> 24h window closed; this must be a template message.');
    if (e.code === 190) console.error('  -> access token expired. Generate a permanent System User token.');
    process.exitCode = 1;
    return false;
  }
  console.log(`WhatsApp digest sent to ${waTo} (id ${json.messages?.[0]?.id}).`);
  return true;
}

import { config } from './config.js';

// If the nightly run dies, say so out loud. A digest that silently stops is
// worse than no digest, because you keep trusting it.
export async function notifyFailure(err, context = 'nightly run') {
  if (!config.resendKey || !config.digestTo || !config.digestFrom) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.digestFrom,
        to: config.digestTo,
        subject: `College digest FAILED — ${context}`,
        html: `<div style="font-family:system-ui;padding:20px;max-width:600px">
          <h2 style="margin:0 0 8px">The ${context} failed</h2>
          <p style="color:#667085;font-size:14px">No digest was sent, and the dashboard still shows the previous snapshot.</p>
          <pre style="background:#f9fafb;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap">${String(err?.stack || err).slice(0, 2000).replace(/</g, '&lt;')}</pre>
          <p style="font-size:13px;color:#667085">Most likely cause: the Google OAuth app is in "Testing", which expires refresh tokens every 7 days.<br>
          Fix: <code>cd ~/Downloads/classroom-digest &amp;&amp; npm run auth</code> — or publish the consent screen to Production to stop it recurring.</p>
        </div>`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) { console.error('Failure notice could not be sent:', JSON.stringify(body)); return false; }
    console.error('Failure notice emailed.');
    return true;
  } catch (e) {
    console.error('Failure notice could not be sent:', e.message);
    return false;
  }
}

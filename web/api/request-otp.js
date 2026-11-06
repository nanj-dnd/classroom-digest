import { issueChallenge, setCookie } from './_auth.js';

// Rate limiting is per-instance and best-effort; the real protection is that a
// code is only ever emailed to ONE hard-coded address.
const recent = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { AUTH_SECRET, RESEND_API_KEY, DIGEST_FROM, ALLOWED_EMAIL } = process.env;
  if (!AUTH_SECRET || !RESEND_API_KEY || !DIGEST_FROM || !ALLOWED_EMAIL) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const ip = req.headers['x-forwarded-for'] || 'local';
  const last = recent.get(ip) || 0;
  if (Date.now() - last < 30_000) return res.status(429).json({ error: 'Wait 30 seconds before requesting another code.' });
  recent.set(ip, Date.now());

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { token } = issueChallenge(code);
  setCookie(res, 'chal', token, 600);

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: ALLOWED_EMAIL,
      subject: `${code} is your college dashboard code`,
      html: `<div style="font-family:system-ui;padding:24px"><p>Your sign-in code:</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:.16em">${code}</div>
        <p style="color:#667085;font-size:13px">Valid for 10 minutes. If you didn't ask for this, ignore it.</p></div>`,
    }),
  });

  // Resend returns 200 with an error body in some failure modes.
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) {
    console.error('OTP email failed:', JSON.stringify(body));
    return res.status(502).json({ error: 'Could not send the code.' });
  }
  return res.status(200).json({ ok: true });
}

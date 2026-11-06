import { checkChallenge, issueSession, parseCookies, setCookie } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const code = String(body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code.' });

  const { chal } = parseCookies(req);
  if (!checkChallenge(chal, code)) return res.status(401).json({ error: 'Wrong or expired code.' });

  const { token, maxAge } = issueSession();
  setCookie(res, 'sess', token, maxAge);
  return res.status(200).json({ ok: true });
}

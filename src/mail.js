import { Resend } from 'resend';
import { config } from './config.js';

export async function sendDigest({ subject, html }) {
  if (!config.resendKey || !config.digestTo || !config.digestFrom) {
    console.log('Email not configured (RESEND_API_KEY / DIGEST_FROM / DIGEST_TO) — skipping send.');
    return false;
  }
  const resend = new Resend(config.resendKey);

  // resend.emails.send() resolves with { error } instead of throwing, so an
  // unchecked call fails completely silently. Always read error.
  const { data, error } = await resend.emails.send({
    from: config.digestFrom,
    to: config.digestTo,
    subject,
    html,
  });

  if (error) {
    console.error('Resend refused the digest:', JSON.stringify(error));
    process.exitCode = 1;
    return false;
  }
  console.log(`Digest sent to ${config.digestTo} (id ${data?.id}).`);
  return true;
}

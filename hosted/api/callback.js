import { getState, clearState, sessionCookie, setCookies, safeEqualState, origin } from '../lib/session.js';
import { exchangeCode, missingScopes } from '../lib/google.js';
import { open, issueCode } from '../lib/oauth.js';
import { html, redirect, message } from '../lib/http.js';

// Google comes back here for both sign-ins: the website's (state is a bare
// nonce) and the Claude connector's (state is "m." + a sealed request).
export default async function handler(req, res) {
  const { code, state, error, scope } = req.query;
  setCookies(res, [clearState()]);
  const nonce = getState(req);
  const mcp = String(state || '').startsWith('m.') ? open('mstate', String(state).slice(2)) : null;

  // Hand an error back to Claude when it's the connector flow.
  const toClient = (err, description) => {
    const u = new URL(mcp.ru);
    u.searchParams.set('error', err);
    if (description) u.searchParams.set('error_description', description);
    if (mcp.st) u.searchParams.set('state', mcp.st);
    return redirect(res, u.toString());
  };

  const stateOk = !!nonce && (mcp ? safeEqualState(mcp.nonce, nonce) : !!state && safeEqualState(state, nonce));
  if (!stateOk) {
    return html(res, message('Sign-in expired', 'That sign-in link was stale or opened in a different browser. Go back and start again.'), 400);
  }
  if (error) {
    if (mcp) return toClient('access_denied', 'Google sign-in was cancelled.');
    return html(res, message('Sign-in cancelled', error === 'access_denied'
      ? 'Google sign-in was cancelled, so nothing was shared. You can try again whenever you like.'
      : `Google returned an error: ${error}`), 400);
  }
  if (!code) return html(res, message('Sign-in failed', 'Google did not return a sign-in code. Try again.'), 400);

  let t;
  try { t = await exchangeCode(code, `${origin(req)}/callback`); }
  catch (e) { console.error('token exchange', e.message); return html(res, message('Sign-in failed', 'Google did not accept the sign-in. Try again.'), 400); }

  // Google lets people untick scopes on the consent screen. The token
  // response's scope list is authoritative; the redirect's is a fallback.
  const missing = missingScopes(t.scope || scope);
  if (missing.length) {
    console.warn('missing scopes', { missing, granted: t.scope || scope });
    return html(res, message('Some access was unticked', `Classroom Digest needs all four read-only Classroom permissions. Missing: ${missing.map((s) => s.split('/').pop()).join(', ')}. Sign in again and leave them ticked.`), 400);
  }
  if (!t.refresh_token) {
    return html(res, message('Sign-in incomplete', 'Google did not return a long-lived sign-in. Remove Classroom Digest at myaccount.google.com/permissions, then sign in again.'), 400);
  }

  if (mcp) {
    const u = new URL(mcp.ru);
    u.searchParams.set('code', issueCode({ rt: t.refresh_token, cid: mcp.cid, ru: mcp.ru, cc: mcp.cc }));
    if (mcp.st) u.searchParams.set('state', mcp.st);
    return redirect(res, u.toString());
  }

  setCookies(res, [sessionCookie({ rt: t.refresh_token, at: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 })]);
  redirect(res, '/');
}

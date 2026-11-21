import crypto from 'node:crypto';
import { open, issue } from '../lib/oauth.js';
import { stateCookie, setCookies, origin, sameOrigin } from '../lib/session.js';
import { readForm } from '../lib/oauth.js';
import { authUrl } from '../lib/google.js';
import { html, redirect, message, pageFile } from '../lib/http.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

// Claude sends the student here. We check the request, then hand off to
// Google; /callback finishes and sends a code back to Claude.
// Anyone can register a client, so before Google we show which app is
// asking and where access will go. Only a POST from that page continues,
// which a link alone can't produce.
export default function handler(req, res) {
  const confirmed = req.method === 'POST';
  if (confirmed && !sameOrigin(req)) return html(res, message('Bad request', 'Start the connection from your Claude app.'), 403);
  const q = confirmed ? readForm(req) : req.query;
  const client = open('client', q.client_id);
  if (!client) return html(res, message('Unknown app', 'This connection request came from an app that is not registered. Remove the connector in Claude and add it again.'), 400);
  if (!client.uris.includes(q.redirect_uri)) return html(res, message('Bad request', 'The return address does not match the registered app.'), 400);

  const back = (error, description) => {
    const u = new URL(q.redirect_uri);
    u.searchParams.set('error', error);
    if (description) u.searchParams.set('error_description', description);
    if (q.state) u.searchParams.set('state', q.state);
    redirect(res, u.toString());
  };
  if (q.response_type !== 'code') return back('unsupported_response_type');
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request', 'PKCE with S256 is required.');

  if (!confirmed) {
    const host = new URL(q.redirect_uri).host;
    const known = /^(claude\.ai|claude\.com)$/.test(host) || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const hidden = FIELDS.filter((f) => q[f] != null).map((f) => `<input type="hidden" name="${f}" value="${esc(q[f])}">`).join('');
    return html(res, pageFile('connect.html')
      .replace('{{client}}', esc(client.name))
      .replace('{{host}}', esc(host))
      .replace('{{warn}}', known ? '' : `<div class="note"><p><b>${esc(host)} is not Claude.</b> Only continue if you set this connection up yourself in an app you trust. Whoever runs that address will be able to read your Classroom.</p></div>`)
      .replace('{{fields}}', hidden));
  }

  // Bound to this browser by the nonce cookie, so a stolen link is useless.
  const nonce = crypto.randomBytes(18).toString('base64url');
  const state = 'm.' + issue('mstate', {
    nonce, cid: q.client_id, ru: q.redirect_uri, st: q.state || '', cc: q.code_challenge,
  }, 600);
  setCookies(res, [stateCookie(nonce)]);
  redirect(res, authUrl(`${origin(req)}/callback`, state));
}

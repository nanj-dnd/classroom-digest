import { open, issueAccess, issueRefresh, pkceOk, cors, readForm, ACCESS_TTL } from '../lib/oauth.js';
import { refresh } from '../lib/google.js';
import { json } from '../lib/http.js';

const fail = (res, code, error, error_description) => json(res, code, { error, error_description });

// Our access token carries a fresh Google access token, so a tool call costs
// one Classroom round trip and nothing else.
async function tokens(res, g) {
  const t = await refresh(g);
  const ttl = Math.min(ACCESS_TTL, (t.expires_in || 3600) - 60);
  json(res, 200, {
    access_token: issueAccess({ rt: g, gat: t.access_token, gexp: Date.now() + ttl * 1000 }),
    token_type: 'Bearer',
    expires_in: ttl,
    refresh_token: issueRefresh({ rt: g }),
    scope: 'classroom',
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return fail(res, 405, 'invalid_request');
  res.setHeader('Pragma', 'no-cache');
  const b = readForm(req);
  try {
    if (b.grant_type === 'authorization_code') {
      const c = open('code', b.code);
      if (!c) return fail(res, 400, 'invalid_grant', 'Code is invalid or expired.');
      if (c.cid !== b.client_id || c.ru !== b.redirect_uri) return fail(res, 400, 'invalid_grant', 'Code was issued to a different client.');
      if (!pkceOk(b.code_verifier, c.cc)) return fail(res, 400, 'invalid_grant', 'PKCE verification failed.');
      return await tokens(res, c.rt);
    }
    if (b.grant_type === 'refresh_token') {
      const r = open('rt', b.refresh_token);
      if (!r) return fail(res, 400, 'invalid_grant', 'Refresh token is invalid or expired.');
      return await tokens(res, r.rt);
    }
    return fail(res, 400, 'unsupported_grant_type');
  } catch (e) {
    if (e.code === 'invalid_grant') return fail(res, 400, 'invalid_grant', 'Google access was revoked. Reconnect the connector.');
    console.error('token', e.message);
    return fail(res, 502, 'server_error', 'Could not reach Google.');
  }
}

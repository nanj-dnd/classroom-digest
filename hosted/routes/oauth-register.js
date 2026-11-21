import { issue, okRedirect, cors, readForm } from '../lib/oauth.js';
import { json } from '../lib/http.js';

// Dynamic client registration (RFC 7591). The client id *is* the sealed
// registration, so nothing needs storing.
export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' });
  const b = readForm(req);
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) {
    return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https, or http on localhost.' });
  }
  const name = String(b.client_name || 'MCP client').slice(0, 100);
  const client_id = issue('client', { uris, name });
  json(res, 201, {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}

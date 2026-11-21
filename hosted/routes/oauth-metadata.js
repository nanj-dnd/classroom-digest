import { base, cors } from '../lib/oauth.js';
import { json } from '../lib/http.js';

// RFC 9728 (protected resource) and RFC 8414 (authorization server)
// metadata, which is how Claude finds out how to sign the student in.
export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const b = base(req);
  if (req.query.kind === 'resource') {
    return json(res, 200, {
      resource: `${b}/mcp`,
      authorization_servers: [b],
      bearer_methods_supported: ['header'],
      resource_name: 'Classroom Digest',
      resource_documentation: b,
    });
  }
  json(res, 200, {
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['classroom'],
    service_documentation: b,
  });
}

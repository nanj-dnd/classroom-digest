// One function for every route: the Hobby plan allows 12 per deployment.
// vercel.json rewrites each public path to /api/main?route=<name>.
import home from '../routes/home.js';
import privacy from '../routes/privacy.js';
import signin from '../routes/signin.js';
import callback from '../routes/callback.js';
import signout from '../routes/signout.js';
import data from '../routes/data.js';
import prefs from '../routes/prefs.js';
import testEmail from '../routes/test-email.js';
import deleteAccount from '../routes/delete-account.js';
import unsubscribe from '../routes/unsubscribe.js';
import cron from '../routes/cron.js';
import mcp from '../routes/mcp.js';
import oauthMetadata from '../routes/oauth-metadata.js';
import oauthRegister from '../routes/oauth-register.js';
import oauthAuthorize from '../routes/oauth-authorize.js';
import oauthToken from '../routes/oauth-token.js';

const ROUTES = {
  home, privacy, signin, callback, signout, data, prefs, 'test-email': testEmail, 'delete-account': deleteAccount,
  unsubscribe, cron, mcp, 'oauth-metadata': oauthMetadata, 'oauth-register': oauthRegister,
  'oauth-authorize': oauthAuthorize, 'oauth-token': oauthToken,
};

export default async function handler(req, res) {
  const route = ROUTES[String(req.query.route || '')];
  if (!route) { res.statusCode = 404; return res.end('Not found'); }
  try { await route(req, res); }
  catch (e) {
    console.error('unhandled', req.query.route, e);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"Something went wrong."}'); }
    else res.end();
  }
}

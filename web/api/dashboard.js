import { checkSession, parseCookies } from './_auth.js';
import { PAYLOAD } from './_payload.js';
import { TEMPLATE } from './_template.js';

// The dashboard is served through a function, not as a static file, so an
// unauthenticated request never receives the coursework at all.
export default async function handler(req, res) {
  const { sess } = parseCookies(req);
  if (!checkSession(sess)) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(TEMPLATE.replace('/*__DATA__*/null', JSON.stringify(PAYLOAD)));
}

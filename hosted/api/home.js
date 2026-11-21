import { getSession } from '../lib/session.js';
import { html, pageFile } from '../lib/http.js';

// Signed out: what this is and a sign-in button. Signed in: the dashboard,
// which loads its data from /api/data.
export default function handler(req, res) {
  html(res, pageFile(getSession(req) ? 'dashboard.html' : 'landing.html'));
}

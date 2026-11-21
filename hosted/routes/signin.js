import crypto from 'node:crypto';
import { stateCookie, setCookies, origin } from '../lib/session.js';
import { authUrl } from '../lib/google.js';
import { html, redirect, message } from '../lib/http.js';

export default function handler(req, res) {
  const state = crypto.randomBytes(18).toString('base64url');
  let to;
  try { to = authUrl(`${origin(req)}/callback`, state); }
  catch (e) { console.error(e); return html(res, message('Sign-in is not set up', 'This site is missing its Google sign-in settings. Try again later.'), 500); }
  setCookies(res, [stateCookie(state)]);
  redirect(res, to);
}

import { html, pageFile } from '../lib/http.js';
export default function handler(req, res) { html(res, pageFile('privacy.html')); }

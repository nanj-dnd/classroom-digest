import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';

// Google downloads OAuth clients as client_secret_<id>.apps.googleusercontent.com.json.
// Find the newest one lying around and put it where the tool expects it.
export function adopt(explicit) {
  const dest = path.join(ROOT, 'credentials.json');
  let src = explicit;

  if (!src) {
    const dirs = [path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), os.homedir()];
    const found = [];
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      for (const n of names) {
        if (!/^client_secret.*\.json$/i.test(n) && !/googleusercontent.*\.json$/i.test(n)) continue;
        const f = path.join(d, n);
        try { found.push({ f, t: fs.statSync(f).mtimeMs }); } catch {}
      }
    }
    found.sort((a, b) => b.t - a.t);
    src = found[0]?.f;
    if (found.length > 1) console.log(`Found ${found.length} candidates; using the newest.`);
  }

  if (!src) {
    console.log('No client_secret*.json found in ~/Downloads, ~/Desktop or ~/.');
    console.log('Create one at https://console.cloud.google.com/auth/clients (Application type: Desktop app),');
    console.log('download it, then rerun:  node src/index.js adopt');
    return false;
  }
  if (!fs.existsSync(src)) { console.log(`No such file: ${src}`); return false; }

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(src, 'utf8')); }
  catch (e) { console.log(`${src} is not valid JSON: ${e.message}`); return false; }

  if (parsed.web && !parsed.installed) {
    console.log(`${path.basename(src)} is a "Web application" client. Recreate it as Application type: Desktop app.`);
    return false;
  }
  if (!parsed.installed) { console.log(`${path.basename(src)} is not an OAuth client file.`); return false; }

  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
  console.log(`Adopted ${src}\n     -> ${dest}`);
  console.log(`Project: ${parsed.installed.project_id || '(unnamed)'}`);
  console.log(`\nNext:  npm run auth`);
  return true;
}

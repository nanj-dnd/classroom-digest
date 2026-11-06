import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from './config.js';

const run = promisify(execFile);
const WEB = path.join(ROOT, 'web');

// launchd runs with a minimal PATH, so a bare "vercel" is not findable.
function findVercel() {
  for (const p of ['/usr/local/bin/vercel', '/opt/homebrew/bin/vercel', `${process.env.HOME}/.npm-global/bin/vercel`]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function deploy() {
  if (!fs.existsSync(path.join(WEB, '.vercel', 'project.json'))) {
    return { skipped: 'web/ is not linked to a Vercel project' };
  }
  const bin = findVercel();
  if (!bin) return { skipped: 'vercel CLI not found' };

  const { stdout } = await run(bin, ['--prod', '--yes'], {
    cwd: WEB,
    timeout: 5 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin'}` },
  });
  const url = (stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/i) || [])[0] || null;
  return { url };
}

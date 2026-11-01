import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const origin = process.argv.find(arg => /^https:\/\//.test(arg));
if (!origin) throw new Error('Usage: npm run team-link -- https://YOUR-WORKER.workers.dev [--rotate]');
const base = new URL(origin);
if (base.pathname !== '/' || base.search || base.hash) throw new Error('Pass only the deployed site origin.');
await mkdir('artifacts', { recursive: true });
let token;
try { token = (await readFile('artifacts/team-token.txt', 'utf8')).trim(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!token || process.argv.includes('--rotate')) token = randomBytes(32).toString('base64url');
if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Invalid saved token.');
// Save before uploading so a failed network request can be retried with the same invitation.
await writeFile('artifacts/team-token.txt', token);
const hash = createHash('sha256').update(token).digest('hex');
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'put', 'TEAM_TOKEN_HASH'], {
  input: hash + '\n', stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.status !== 0) throw new Error('Could not configure the team invitation. Retry this command.');
const link = `${base.origin}/#team=${token}`;
await writeFile('artifacts/team-link.txt', link + '\n');
console.log('\nTeam invitation (keep private):\n' + link);

// npm run release [patch|minor|major]: bump the manifest version, commit, tag and push.
// The GitHub Action then builds the zip and attaches it to a release; friends' panels see it.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const kind = process.argv[2] ?? 'patch';
const run = (...a) => execFileSync('git', a, { stdio: 'inherit' });
if (execFileSync('git', ['status', '--porcelain']).toString().trim()) throw new Error('commit your changes first');
const p = 'public/manifest.json';
const m = JSON.parse(readFileSync(p, 'utf8'));
const [a, b, c] = m.version.split('.').map(Number);
m.version = kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
run('commit', '-am', `chore: release v${m.version}`);
run('tag', `v${m.version}`);
run('push', 'origin', 'HEAD', `v${m.version}`);
console.log(`v${m.version} pushed; the release appears at https://github.com/10x4hs/Uwts/releases in about a minute`);

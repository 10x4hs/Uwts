// Build a zip friends can load with "Load unpacked": release/uwts-lyrics-<version>.zip
// containing one folder (uwts-lyrics/) with the extension and a Korean install guide.
import { cpSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const stage = 'release/uwts-lyrics';
const zip = `uwts-lyrics-${version}.zip`;
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// Chrome writes _metadata/ into a loaded unpacked folder; never ship it
cpSync('dist', stage, { recursive: true, filter: (src) => !src.includes('_metadata') });
cpSync('docs/INSTALL.txt', `${stage}/INSTALL.txt`);
if (existsSync(`release/${zip}`)) rmSync(`release/${zip}`);
execFileSync('zip', ['-r', '-X', '-q', zip, 'uwts-lyrics'], { cwd: 'release' });
console.log(`release/${zip}`);

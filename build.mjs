import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
// Every build gets a fresh id: a loaded (unpacked) copy compares it with dist/build.txt on disk
// and reloads itself when they differ, so `npm run build` updates the running extension.
const BUILD = Date.now().toString(36);
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
await build({
  entryPoints: { background: 'src/background/index.ts', content: 'src/content/index.ts', grant: 'src/grant/index.ts' },
  bundle: true, format: 'iife', target: 'chrome120', outdir: 'dist', logLevel: 'info',
  define: { __UW_BUILD__: JSON.stringify(BUILD) },
});
writeFileSync('dist/build.txt', BUILD + '\n');

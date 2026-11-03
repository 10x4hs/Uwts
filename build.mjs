import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
await build({
  entryPoints: { background: 'src/background/index.ts', content: 'src/content/index.ts', grant: 'src/grant/index.ts' },
  bundle: true, format: 'iife', target: 'chrome120', outdir: 'dist', logLevel: 'info',
});

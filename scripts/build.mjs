// Bundles the renderer (React + TypeScript) with esbuild into dist/renderer.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'renderer');
const watch = process.argv.includes('--watch');
const entry = process.env.ENTRY || 'src/main.tsx';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'src', 'index.html'), join(out, 'index.html'));
cpSync(join(root, 'src', 'styles.css'), join(out, 'styles.css'));

const opts = {
  entryPoints: [join(root, entry)],
  bundle: true,
  outfile: join(out, 'app.js'),
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  sourcemap: true,
  minify: !watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  nodePaths: process.env.EXTRA_NODE_PATH ? [process.env.EXTRA_NODE_PATH] : [],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}

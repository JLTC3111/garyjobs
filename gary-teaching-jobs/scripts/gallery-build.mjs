import { context, build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildGallery({ watch = false } = {}) {
  const options = {
    absWorkingDir: root,
    entryPoints: { 'photo-gallery': 'src/react-islands.jsx' },
    outdir: 'dist',
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    target: ['es2020'],
    minify: true,
    legalComments: 'linked',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  };
  if (!watch) { const result = await build(options); await copyFile(new URL('../src/components/react-bits/LICENSE.md', import.meta.url), new URL('../dist/REACT-BITS-LICENSE.txt', import.meta.url)); return result; }
  const builder = await context(options);
  await builder.rebuild();
  await builder.watch();
  return builder;
}

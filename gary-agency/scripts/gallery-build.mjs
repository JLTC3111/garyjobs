import { context, build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildGallery({ watch = false } = {}) {
  const options = {
    absWorkingDir: root,
    entryPoints: { 'photo-gallery': 'src/components/PhotoGallery.jsx' },
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
  if (!watch) return build(options);
  const builder = await context(options);
  await builder.rebuild();
  await builder.watch();
  return builder;
}

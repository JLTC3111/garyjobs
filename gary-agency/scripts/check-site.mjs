import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const base = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', base), 'utf8');
const js = await readFile(new URL('app.js', base), 'utf8');
const css = await readFile(new URL('styles.css', base), 'utf8');
const galleryJS = await readFile(new URL('photo-gallery.js', base), 'utf8');
const galleryCSS = await readFile(new URL('photo-gallery.css', base), 'utf8');
const photos = JSON.parse(await readFile(new URL('../src/data/photos.json', base), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('site.webmanifest', base), 'utf8'));
const assets = [...new Set([
  ...(html + js + css + galleryJS + galleryCSS).match(/assets\/[a-zA-Z0-9_./-]+\.(?:webp|svg|ttf|woff2|png|ico)/g),
  ...manifest.icons.map(icon => icon.src),
  ...photos.map(photo => photo.src),
])];
for (const path of assets) {
  const info = await stat(new URL(path, base));
  if (!info.size) throw new Error(`Empty asset: ${path}`);
}
const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('app.js', base))], { stdio: 'inherit' });
if (syntax.status) process.exit(syntax.status);
const gallerySyntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('photo-gallery.js', base))], { stdio: 'inherit' });
if (gallerySyntax.status) process.exit(gallerySyntax.status);
if (new Set(photos.map(photo => photo.id)).size !== photos.length) throw new Error('Duplicate gallery photo IDs');
for (const photo of photos) {
  if (!photo.title.en || !photo.title.vi || !photo.alt.en || !photo.alt.vi) throw new Error(`Missing photo caption: ${photo.id}`);
}
for (const region of ['hagiang', 'hoian', 'hanoi']) {
  const originalFiles = (await readdir(new URL(`assets/public/images/${region}/`, base))).filter(name => /\.(jpe?g|heic|png)$/i.test(name));
  const sources = new Set(photos.filter(photo => photo.region === region).map(photo => photo.source.split('/').pop()));
  for (const file of originalFiles) if (!sources.has(file)) throw new Error(`Photo not yet included in the gallery: ${region}/${file}`);
}
if (!html.includes('name="description"')) throw new Error('Missing description');
if (!js.includes('id="gary-apps-header"') || !js.includes('mountGaryApps') || !galleryJS.includes('Our Platforms') || !galleryCSS.includes('.gary-apps-menu')) throw new Error('Gary Apps header menu is missing');
const files = await readdir(new URL('assets/', base));
for (const name of files) if (!(await stat(new URL(`assets/${name}`, base))).size) throw new Error(`Empty asset: ${name}`);
console.log(`Static site ready. JavaScript syntax, ${assets.length} asset references and all ${photos.length} supplied photos verified.`);

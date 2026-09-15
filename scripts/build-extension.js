import { mkdir, copyFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const output = resolve(Bun.argv[2] ?? `${root}/build/extension`);
await mkdir(`${output}/app/src`, { recursive: true });
for (const file of [
  'extension.js',
  'overview.js',
  'compositing.js',
  'metadata.json',
])
  await copyFile(`${root}/extension/${file}`, `${output}/${file}`);
for (const file of [
  'desktop-renderer.js',
  'preview.js',
  'debug-info.js',
  'images.js',
  'paths.js',
  'storage.js',
  'catalog.js',
  'paper-catalog.js',
  'live-config.js',
])
  await copyFile(`${root}/src/${file}`, `${output}/app/src/${file}`);
await cp(`${root}/build/renderer`, `${output}/app/build/renderer`, {
  recursive: true,
});
await cp(`${root}/data/third-party`, `${output}/app/data/third-party`, {
  recursive: true,
});
await copyFile(`${root}/COPYING`, `${output}/COPYING`);
await copyFile(`${root}/data/style.css`, `${output}/app/data/style.css`);
console.log(`Built GNOME Shell extension: ${output}`);

import { mkdir, copyFile, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const output = resolve(Bun.argv[2] ?? `${root}/build/extension`);
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/app/src`, { recursive: true });
const shellHash = createHash('sha256');
for (const file of [
  'extension.js',
  'overview.js',
  'background.js',
  'compositing.js',
  'desktop-menu.js',
  'metadata.json',
]) {
  await copyFile(`${root}/extension/${file}`, `${output}/${file}`);
  shellHash
    .update(file)
    .update('\0')
    .update(await readFile(`${root}/extension/${file}`))
    .update('\0');
}
for (const file of [
  'desktop-renderer.js',
  'preview.js',
  'debug-info.js',
  'images.js',
  'paths.js',
  'i18n.js',
  'translation.js',
  'language.js',
  'storage.js',
  'catalog.js',
  'paper-catalog.js',
  'paper-migration.js',
  'live-config.js',
]) {
  await copyFile(`${root}/src/${file}`, `${output}/app/src/${file}`);
  // Shared modules are cached inside Shell too. Only renderer modules can be
  // refreshed without a new Shell session.
  if (
    ![
      'desktop-renderer.js',
      'preview.js',
      'debug-info.js',
      'images.js',
    ].includes(file)
  )
    shellHash
      .update(`app/src/${file}`)
      .update('\0')
      .update(await readFile(`${root}/src/${file}`))
      .update('\0');
}
const metadata = JSON.parse(await readFile(`${output}/metadata.json`, 'utf8'));
metadata['wallshader-shell-id'] = shellHash.digest('hex');
await writeFile(
  `${output}/build-info.js`,
  `export const SHELL_BUILD_ID = '${metadata['wallshader-shell-id']}';\n`,
);
await writeFile(
  `${output}/metadata.json`,
  `${JSON.stringify(metadata, null, 2)}\n`,
);
await cp(`${root}/build/renderer`, `${output}/app/build/renderer`, {
  recursive: true,
});
await rm(`${output}/app/build/locale`, { recursive: true, force: true });
await cp(`${root}/build/locale`, `${output}/app/build/locale`, {
  recursive: true,
});
await cp(`${root}/data/third-party`, `${output}/app/data/third-party`, {
  recursive: true,
});
await copyFile(`${root}/COPYING`, `${output}/COPYING`);
await copyFile(`${root}/data/style.css`, `${output}/app/data/style.css`);
console.log(`Built GNOME Shell extension: ${output}`);

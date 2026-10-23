import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
export async function buildExtension(
  output = `${root}/build/extension`,
  rendererDirectory = `${root}/build/renderer`,
  localeDirectory = `${root}/build/locale`,
) {
  await mkdir(`${output}/app/src`, { recursive: true });
  for (const file of [
    'extension.js',
    'overview.js',
    'background.js',
    'compositing.js',
    'desktop-menu.js',
    'metadata.json',
  ])
    await copyFile(`${root}/extension/${file}`, `${output}/${file}`);
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
  ])
    await copyFile(`${root}/src/${file}`, `${output}/app/src/${file}`);
  const rendererOutput = `${output}/app/build/renderer`;
  await rm(rendererOutput, { recursive: true, force: true });
  await mkdir(rendererOutput, { recursive: true });
  for (const file of ['renderer.js', 'index.html'])
    await copyFile(`${rendererDirectory}/${file}`, `${rendererOutput}/${file}`);
  await rm(`${output}/app/build/locale`, { recursive: true, force: true });
  await cp(localeDirectory, `${output}/app/build/locale`, {
    recursive: true,
  });
  await cp(`${root}/data/third-party`, `${output}/app/data/third-party`, {
    recursive: true,
  });
  await copyFile(`${root}/COPYING`, `${output}/COPYING`);
  await copyFile(`${root}/data/style.css`, `${output}/app/data/style.css`);
  console.log(`Built GNOME Shell extension: ${output}`);
}

if (import.meta.main)
  await buildExtension(resolve(Bun.argv[2] ?? `${root}/build/extension`));

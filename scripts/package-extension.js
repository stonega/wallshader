import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildTranslations } from './build-translations.js';
import { buildExtension } from './build-extension.js';

const root = resolve(import.meta.dir, '..');
const output = resolve(Bun.argv[2] ?? `${root}/dist/wallshader-extension.zip`);
const renderer = Bun.argv[3]
  ? dirname(resolve(Bun.argv[3]))
  : `${root}/build/renderer`;
const resourceOutput = Bun.argv[4] ? resolve(Bun.argv[4]) : null;
const work = await mkdtemp(`${tmpdir()}/wallshader-extension.`);
try {
  await buildTranslations(`${work}/locale`);
  await buildExtension(`${work}/extension`, renderer, `${work}/locale`);
  await mkdir(dirname(output), { recursive: true });
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree.ElementTree import Element, SubElement, ElementTree
directory = Path(sys.argv[2])
files = sorted(path for path in directory.rglob('*') if path.is_file())
with ZipFile(sys.argv[1], 'w', compression=ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(directory))
resources = Element('gresources')
resource = SubElement(resources, 'gresource', prefix='/io/github/wallshader/extension')
for path in files:
    SubElement(resource, 'file', compressed='true').text = str(path.relative_to(directory))
ElementTree(resources).write(directory.parent / 'extension.gresource.xml')
`,
      output,
      `${work}/extension`,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Extension ZIP build failed');
  if (resourceOutput) {
    await mkdir(dirname(resourceOutput), { recursive: true });
    const compiled = spawnSync(
      'glib-compile-resources',
      [
        `${work}/extension.gresource.xml`,
        `--sourcedir=${work}/extension`,
        `--target=${resourceOutput}`,
      ],
      { stdio: 'inherit' },
    );
    if (compiled.error) throw compiled.error;
    if (compiled.status !== 0)
      throw new Error('Extension resource build failed');
  }
  console.log(`Built animation extension ZIP: ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}

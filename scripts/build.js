import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const outdir = resolve(Bun.argv[2] ?? `${root}/build/renderer`);
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [`${root}/src/renderer/renderer.js`],
  outdir,
  target: 'browser',
  format: 'iife',
  minify: true,
  plugins: [
    {
      name: 'embedded-webp',
      setup(build) {
        build.onLoad({ filter: /\.webp$/ }, async ({ path }) => ({
          contents: `data:image/webp;base64,${(await readFile(path)).toString('base64')}`,
          loader: 'text',
        }));
      },
    },
  ],
});
if (!result.success)
  throw new AggregateError(result.logs, 'Renderer build failed');
await copyFile(`${root}/src/renderer/index.html`, `${outdir}/index.html`);
await mkdir(`${root}/data/third-party`, { recursive: true });
for (const file of ['LICENSE', 'NOTICE'])
  await copyFile(
    `${root}/node_modules/@paper-design/shaders/${file}`,
    `${root}/data/third-party/Paper-Shaders-${file}`,
  );
console.log('Built local Paper Shaders renderer.');

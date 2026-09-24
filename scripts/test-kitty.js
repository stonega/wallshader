import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { exportKittyFixture, kittyFixtures } from '../tests/kitty-fixtures.js';

const root = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'wallshader-kitty-test.'));
try {
  for (const [name, preset] of kittyFixtures) {
    const shader = exportKittyFixture(preset);
    await Bun.write(join(directory, name, 'wallshader.slang'), shader.source);
    for (const [index, source] of shader.textures.entries())
      await Bun.write(
        join(directory, name, `wallshader-texture-${index}.slang`),
        source,
      );
    await Bun.write(
      join(directory, name, 'wallshader.pipeline'),
      shader.pipeline,
    );
  }
  const config = join(directory, 'config');
  await mkdir(config);
  const process = Bun.spawn(
    [
      'kitty',
      '+runpy',
      'import runpy, sys; runpy.run_path(sys.argv[1], run_name="__main__")',
      join(root, 'tests/kitty-compile.py'),
      directory,
    ],
    {
      env: {
        ...Bun.env,
        KITTY_CONFIG_DIRECTORY: config,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: join(directory, 'cache'),
        XDG_DATA_HOME: join(directory, 'data'),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  if (await process.exited) throw new Error('Kitty shader compilation failed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}

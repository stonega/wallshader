import { expect, test } from 'bun:test';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXTENSION_UUID } from '../src/live-config.js';

const root = resolve(import.meta.dir, '..');
const shellId = 'a'.repeat(64);
async function write(path, contents) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, contents);
}
async function bundle(directory, id = shellId) {
  await write(
    join(directory, 'metadata.json'),
    JSON.stringify({ uuid: EXTENSION_UUID, 'wallshader-shell-id': id }),
  );
  await write(join(directory, 'extension.js'), '// current Shell code');
  await write(
    join(directory, 'build-info.js'),
    `export const SHELL_BUILD_ID = '${id}';`,
  );
  await write(
    join(directory, 'app/src/desktop-renderer.js'),
    '// renderer source',
  );
  await write(
    join(directory, 'app/build/renderer/renderer.js'),
    '// renderer bundle',
  );
}
function run(directory, options, dbus = false) {
  const args = [
    '-m',
    join(root, 'tests/extension-install-driver.js'),
    JSON.stringify(options),
  ];
  const result = spawnSync(
    dbus ? 'dbus-run-session' : 'gjs',
    dbus ? ['--', 'gjs', ...args] : args,
    {
      cwd: root,
      env: {
        ...process.env,
        XDG_DATA_HOME: join(directory, 'data'),
        XDG_CONFIG_HOME: join(directory, 'config'),
        XDG_CACHE_HOME: join(directory, 'cache'),
        XDG_RUNTIME_DIR: join(directory, 'runtime'),
        GSETTINGS_BACKEND: 'memory',
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${directory}/no-bus`,
        DISPLAY: '',
        WAYLAND_DISPLAY: '',
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  return {
    ...result,
    value: result.status === 0 ? JSON.parse(result.stdout.trim()) : null,
  };
}
async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'wallshader-auto-update.'));
  await mkdir(join(directory, 'runtime'), { mode: 0o700 });
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('startup leaves first-time animation installation to explicit apply', async () => {
  await fixture(async (directory) => {
    const destination = join(directory, 'extensions', EXTENSION_UUID);
    const result = run(directory, { destination });
    expect(result.status, result.stderr).toBe(0);
    expect(result.value).toEqual({
      updated: false,
      shellChanged: false,
      shellId: null,
    });
    expect(await stat(destination).catch(() => null)).toBeNull();
    const source = join(directory, 'bundle');
    await bundle(source);
    const installed = run(directory, {
      bundle: source,
      destination,
      install: true,
    });
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.value).toEqual({
      updated: true,
      shellChanged: false,
      shellId,
    });
  });
});

test('automatic upgrade removes obsolete files, preserves other extensions and does not rewrite matching files', async () => {
  await fixture(async (directory) => {
    const source = join(directory, 'bundle');
    const destination = join(directory, 'extensions', EXTENSION_UUID);
    await bundle(source);
    await bundle(destination, 'b'.repeat(64));
    await write(join(destination, 'obsolete.js'), '// removed upstream');
    await write(join(directory, 'extensions', 'unrelated'), 'keep');
    let result = run(directory, { bundle: source, destination });
    expect(result.status, result.stderr).toBe(0);
    expect(result.value).toEqual({
      updated: true,
      shellChanged: true,
      shellId,
    });
    expect(
      await stat(join(destination, 'obsolete.js')).catch(() => null),
    ).toBeNull();
    expect(
      await readFile(join(directory, 'extensions', 'unrelated'), 'utf8'),
    ).toBe('keep');
    const before = await stat(join(destination, 'metadata.json'));
    result = run(directory, { bundle: source, destination });
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.updated).toBe(false);
    expect((await stat(join(destination, 'metadata.json'))).ino).toBe(
      before.ino,
    );
    expect((await readdir(join(directory, 'extensions'))).sort()).toEqual([
      'unrelated',
      EXTENSION_UUID,
    ]);
    await write(
      join(source, 'app/build/renderer/renderer.js'),
      '// updated renderer only',
    );
    result = run(directory, { bundle: source, destination });
    expect(result.status, result.stderr).toBe(0);
    expect(result.value).toEqual({
      updated: true,
      shellChanged: false,
      shellId,
    });
    expect(
      await readFile(
        join(destination, 'app/build/renderer/renderer.js'),
        'utf8',
      ),
    ).toBe('// updated renderer only');
  });
});

test('an invalid bundle preserves the installed extension and symlink targets', async () => {
  await fixture(async (directory) => {
    const source = join(directory, 'bundle');
    const destination = join(directory, 'extensions', EXTENSION_UUID);
    await bundle(source);
    await bundle(destination, 'b'.repeat(64));
    await write(join(directory, 'outside'), 'keep');
    await symlink(join(directory, 'outside'), join(source, 'unsupported'));
    const result = run(directory, { bundle: source, destination });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported file');
    expect(
      JSON.parse(await readFile(join(destination, 'metadata.json'), 'utf8'))[
        'wallshader-shell-id'
      ],
    ).toBe('b'.repeat(64));
    expect(await readFile(join(directory, 'outside'), 'utf8')).toBe('keep');
    expect(await readdir(join(directory, 'extensions'))).toEqual([
      EXTENSION_UUID,
    ]);
  });
});

test('upgrading a linked installation leaves its original directory untouched', async () => {
  await fixture(async (directory) => {
    const source = join(directory, 'bundle');
    const destination = join(directory, 'extensions', EXTENSION_UUID);
    const outside = join(directory, 'outside');
    await bundle(source);
    await bundle(outside, 'b'.repeat(64));
    await mkdir(resolve(destination, '..'), { recursive: true });
    await symlink(outside, destination);
    const result = run(directory, { bundle: source, destination });
    expect(result.status, result.stderr).toBe(0);
    expect((await stat(destination)).isDirectory()).toBe(true);
    expect(
      JSON.parse(await readFile(join(outside, 'metadata.json'), 'utf8'))[
        'wallshader-shell-id'
      ],
    ).toBe('b'.repeat(64));
    expect(
      JSON.parse(await readFile(join(destination, 'metadata.json'), 'utf8'))[
        'wallshader-shell-id'
      ],
    ).toBe(shellId);
  });
});

test('reopening the app still requires login until Shell reports the updated code', async () => {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  expect(build.status, build.stderr).toBe(0);
  await fixture(async (directory) => {
    const destination = join(
      directory,
      'data/gnome-shell/extensions',
      EXTENSION_UUID,
    );
    await bundle(destination, 'b'.repeat(64));
    const metadata = JSON.parse(
      await readFile(join(root, 'build/extension/metadata.json'), 'utf8'),
    );
    const result = run(
      directory,
      { controller: true, shellId: metadata['wallshader-shell-id'] },
      true,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.value.map((value) => value.loginRequired)).toEqual([
      true,
      true,
      false,
    ]);
    expect(result.value.map((value) => value.status.active)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      JSON.parse(await readFile(join(destination, 'metadata.json'), 'utf8')),
    ).toEqual(metadata);
    expect(
      await stat(
        join(directory, 'config/wallshader/live-wallpaper.json'),
      ).catch(() => null),
    ).toBeNull();
  });
});

test('the loaded-code identifier tracks shared Shell modules and ignores renderer-only changes', async () => {
  await fixture(async (directory) => {
    for (const path of ['extension', 'src', 'data/third-party'])
      await cp(join(root, path), join(directory, path), { recursive: true });
    await write(
      join(directory, 'scripts/build-extension.js'),
      await readFile(join(root, 'scripts/build-extension.js')),
    );
    await cp(join(root, 'COPYING'), join(directory, 'COPYING'));
    await cp(join(root, 'data/style.css'), join(directory, 'data/style.css'));
    await mkdir(join(directory, 'build/locale'), { recursive: true });
    const renderer = join(directory, 'build/renderer/renderer.js');
    await write(renderer, '// renderer one');
    const build = async () => {
      const result = spawnSync('bun', ['scripts/build-extension.js'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(
        await readFile(
          join(directory, 'build/extension/metadata.json'),
          'utf8',
        ),
      )['wallshader-shell-id'];
    };
    const original = await build();
    expect(
      await readFile(join(directory, 'build/extension/build-info.js'), 'utf8'),
    ).toContain(original);
    await write(
      join(directory, 'build/extension/obsolete.js'),
      '// stale output',
    );
    await write(renderer, '// renderer two');
    await write(
      join(directory, 'src/desktop-renderer.js'),
      '// renderer-only source update',
    );
    expect(await build()).toBe(original);
    expect(
      await stat(join(directory, 'build/extension/obsolete.js')).catch(
        () => null,
      ),
    ).toBeNull();
    await write(
      join(directory, 'src/storage.js'),
      '// shared Shell code update',
    );
    expect(await build()).not.toBe(original);
  });
});

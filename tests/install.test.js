import { expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('installer refreshes an existing extension without touching other extensions or Shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wallshader-install-test.'));
  const root = resolve(import.meta.dir, '..');
  const extensions = join(directory, 'gnome-shell', 'extensions');
  const destination = join(extensions, 'wallshader@wallshader.github.io');
  try {
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'extension.js'), '// outdated extension');
    await writeFile(join(extensions, 'unrelated-extension'), 'keep');
    for (let install = 0; install < 2; install++) {
      const result = spawnSync(
        'sh',
        ['scripts/install-extension.sh', '--files-only'],
        {
          cwd: root,
          env: {
            ...process.env,
            XDG_DATA_HOME: directory,
            GSETTINGS_BACKEND: 'memory',
            DBUS_SESSION_BUS_ADDRESS: `unix:path=${directory}/no-session-bus`,
          },
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      for (const file of ['extension.js', 'compositing.js', 'metadata.json'])
        expect(await readFile(join(destination, file), 'utf8')).toBe(
          await readFile(join(root, 'extension', file), 'utf8'),
        );
      expect(
        await readFile(join(extensions, 'unrelated-extension'), 'utf8'),
      ).toBe('keep');
      expect(
        (await readdir(extensions)).some((name) =>
          name.startsWith('.wallshader-install.'),
        ),
      ).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed installation restores the previous extension directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wallshader-install-test.'));
  const destination = join(
    directory,
    'gnome-shell',
    'extensions',
    'wallshader@wallshader.github.io',
  );
  const bin = join(directory, 'bin');
  try {
    await mkdir(destination, { recursive: true });
    await mkdir(bin);
    await writeFile(
      join(destination, 'extension.js'),
      '// previous working extension',
    );
    // Fail publishing the staged directory; let backup and rollback moves work.
    const move = join(bin, 'mv');
    await writeFile(
      move,
      `#!/bin/sh
case "$2" in
  *.previous) exec /usr/bin/mv "$@" ;;
  */.wallshader-install.*) exit 73 ;;
  *) exec /usr/bin/mv "$@" ;;
esac
`,
    );
    await chmod(move, 0o700);
    const result = spawnSync(
      'sh',
      ['scripts/install-extension.sh', '--files-only'],
      {
        cwd: resolve(import.meta.dir, '..'),
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          XDG_DATA_HOME: directory,
          GSETTINGS_BACKEND: 'memory',
          DBUS_SESSION_BUS_ADDRESS: `unix:path=${directory}/no-session-bus`,
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(73);
    expect(await readFile(join(destination, 'extension.js'), 'utf8')).toBe(
      '// previous working extension',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

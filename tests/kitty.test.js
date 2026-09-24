import { expect, test } from 'bun:test';
import { normalizeState } from '../src/catalog.js';
import {
  hasKittyBackground,
  kittyBackgroundConfig,
  removeKittyBackground,
} from '../src/kitty-config.js';

test('Desktop remains the default and Kitty selection survives a restart', () => {
  for (const wallpaperTarget of [null, undefined, 'Desktop', 'bad', true])
    expect(normalizeState({ wallpaperTarget }).wallpaperTarget).toBe('desktop');
  expect(
    normalizeState(
      JSON.parse(JSON.stringify(normalizeState({ wallpaperTarget: 'kitty' }))),
    ),
  ).toMatchObject({ wallpaperTarget: 'kitty' });
});

test('Kitty apply, reapply and restore preserve unrelated settings and later edits', () => {
  const original =
    '# My settings\nfont_size 14\ninclude theme.conf\nbackground_image /original.png\ncustom_shaders crt\n';
  const first = kittyBackgroundConfig(original, '/new.png');
  expect(first.startsWith(original)).toBe(true);
  expect(hasKittyBackground(first)).toBe(true);
  const animated = kittyBackgroundConfig(
    `${first}font_family monospace\n`,
    '/new.png',
    '/shader.pipeline',
  );
  expect(animated.match(/# BEGIN WALLSHADER/g)).toHaveLength(1);
  expect(animated).toContain("custom_shaders '/shader.pipeline'");
  const still = kittyBackgroundConfig(animated, '/second.png');
  expect(still).not.toContain('/shader.pipeline');
  expect(still).toContain('custom_shaders crt');
  expect(removeKittyBackground(still)).toBe(
    `${original}font_family monospace\n`,
  );
  expect(hasKittyBackground(removeKittyBackground(still))).toBe(false);
});

test('Kitty config handles empty files, missing final newline and CRLF', () => {
  expect(removeKittyBackground(kittyBackgroundConfig('', '/a.png'))).toBe('');
  expect(
    removeKittyBackground(kittyBackgroundConfig('font_size 12', '/a.png')),
  ).toBe('font_size 12\n');
  const original = 'font_size 13\r\n';
  expect(removeKittyBackground(kittyBackgroundConfig(original, '/a.png'))).toBe(
    original,
  );
  expect(removeKittyBackground(original)).toBe(original);
});

test('ambiguous or damaged managed blocks are never overwritten', () => {
  for (const source of [
    '# BEGIN WALLSHADER\n',
    '# END WALLSHADER\n',
    '# END WALLSHADER\n# BEGIN WALLSHADER\n',
    '# BEGIN WALLSHADER\n# BEGIN WALLSHADER\n# END WALLSHADER\n',
    kittyBackgroundConfig('', '/a.png').repeat(2),
  ]) {
    expect(() => kittyBackgroundConfig(source, '/b.png')).toThrow();
    expect(() => removeKittyBackground(source)).toThrow();
  }
});

test('Kitty paths use image glob escaping and pipeline shell quoting', () => {
  const config = kittyBackgroundConfig(
    '',
    '/with space/a[1]*?.png',
    "/with space/it's.pipeline",
  );
  expect(config).toContain("custom_shaders '/with space/it'\\''s.pipeline'");
  expect(kittyBackgroundConfig('', '/with space/a[1]*?.png')).toContain(
    'background_image /with space/a[[]1][*][?].png',
  );
  for (const path of ['relative.png', '/x\ninclude evil', '/$HOME/a', '/a\0b'])
    expect(() => kittyBackgroundConfig('', path)).toThrow();
});

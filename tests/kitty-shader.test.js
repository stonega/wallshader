import { expect, test } from 'bun:test';
import { createPreset } from '../src/catalog.js';
import {
  packPixels,
  quantizePixels,
  textureAssets,
} from '../src/renderer/kitty-texture.js';
import { kittyShader } from '../src/renderer/kitty-shader.js';
import { exportKittyFixture, kittyFixtures } from './kitty-fixtures.js';

test('all supported original and Paper presets generate finite Slang constants', () => {
  for (const [, preset] of kittyFixtures) {
    const result = exportKittyFixture(preset);
    expect(result.source).not.toMatch(
      /\b(NaN|undefined|Infinity|uniform|vec[234]|mat[34])\b/,
    );
    expect(result.source).toContain('public float4 fragment_main(');
    expect(result.source).toContain(
      `timestamp * ${Number.isInteger(preset.speed) ? `${preset.speed}.0` : preset.speed}`,
    );
    expect(result.pipeline).toContain('animation_stop never');
  }
});

test('zero speed has no periodic repaint and unsupported shaders fail explicitly', () => {
  const shader = exportKittyFixture({ ...createPreset('aurora'), speed: 0 });
  expect(shader.pipeline).toContain('animation_step 0');
  expect(() =>
    kittyShader({ ...createPreset('aurora'), shader: 'unknown' }, '', {}),
  ).toThrow('Unknown Paper shader');
});

test('noise-only shaders keep the atlas inside the final Kitty pass', () => {
  const shader = exportKittyFixture(createPreset('paper-grain-gradient'));
  expect(shader.source).toContain('static const uint palette0[');
  expect(shader.source).toContain('uint c = palette0[');
  expect(shader.textures).toEqual([]);
  expect(shader.pipeline).not.toContain('output_texture');
  expect(shader.pipeline.match(/startgroup/g)).toHaveLength(1);
});

test('logo animations embed their image atlas in the final Kitty pass', () => {
  for (const id of ['gem-smoke', 'heatmap', 'liquid-metal']) {
    const shader = exportKittyFixture(createPreset(`paper-${id}`));
    expect(shader.source).toContain('static const uint palette0[');
    expect(shader.textures).toEqual([]);
    expect(shader.pipeline).not.toContain('output_texture');
  }
  const filter = exportKittyFixture(createPreset('paper-image-dithering'));
  expect(filter.textures).toHaveLength(1);
  expect(filter.pipeline).toContain('output_texture a');
});

test('texture packing preserves RGBA bytes and existing noise palettes', () => {
  const pixels = packPixels(new Uint8Array([1, 2, 3, 255, 32, 48, 64, 128]));
  expect([...pixels]).toEqual([0xff030201, 0x80403020]);
  expect(quantizePixels([...pixels])).toEqual([...pixels]);
});

test('vector texture tables preserve every texel across word, vector and mip boundaries', () => {
  const pixels = Array.from(
    { length: 128 * 128 + 5 },
    (_, i) => (0xff000000 | (((i * 97) % 256) * 0x010101)) >>> 0,
  );
  const [source] = textureAssets([
    {
      levels: [
        { width: 128, height: 128, pixels: pixels.slice(0, -5) },
        { width: 5, height: 1, pixels: pixels.slice(-5) },
      ],
    },
  ]);
  const palette = source
    .match(/palette0\[256\] = \{([^}]+)\}/)[1]
    .split(',')
    .map((word) => Number.parseInt(word, 10));
  const words = [...source.matchAll(/uint4\(([^)]+)\)/g)].flatMap((match) =>
    match[1].split(',').map((word) => Number.parseInt(word, 10)),
  );
  const decoded = words.flatMap((word) =>
    [0, 8, 16, 24].map((shift) => palette[(word >>> shift) & 255]),
  );
  expect(source).toContain('static const uint4 pixels0[1025]');
  expect(decoded.slice(0, pixels.length)).toEqual(pixels);
  expect(words.slice(-2)).toEqual([0, 0]);
});

test('image palettes are bounded without losing the color range', () => {
  const pixels = Array.from(
    { length: 128 * 128 },
    (_, i) =>
      (0xff000000 | ((i % 128) * 2) | ((Math.floor(i / 128) * 2) << 8)) >>> 0,
  );
  const result = quantizePixels(pixels);
  expect(new Set(result).size).toBeLessThanOrEqual(256);
  expect(result.length).toBe(pixels.length);
  let error = 0;
  for (let i = 0; i < pixels.length; i++) {
    expect(result[i] >>> 24).toBe(255);
    error += Math.abs((result[i] & 255) - (pixels[i] & 255));
    error += Math.abs(((result[i] >>> 8) & 255) - ((pixels[i] >>> 8) & 255));
  }
  expect(error / (pixels.length * 2)).toBeLessThan(5);
});

test('multiple GLSL global constants on one line remain initialized', () => {
  const source = exportKittyFixture(createPreset('paper-halftone-cmyk')).source;
  for (const name of [
    'cosC',
    'sinC',
    'cosM',
    'sinM',
    'cosY',
    'sinY',
    'cosK',
    'sinK',
  ])
    expect(source).toContain(`static const float ${name}`);
});

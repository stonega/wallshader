import { expect, test } from 'bun:test';
import { fromPaperParams, paperParams } from '../src/catalog.js';
import {
  embeddedImagePayload,
  MAX_IMAGE_BYTES,
  MAX_SETTINGS_LENGTH,
} from '../src/image-data.js';
import { exportSettings, parseSettings } from '../src/sharing.js';

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const preset = fromPaperParams('paper-image-dithering', {
  image: 'file:///home/sender/Pictures/photo.png',
  speed: -0.75,
  offsetX: -0.4,
  originalColors: true,
});

test('settings embed image data without leaking or changing the local source', () => {
  const original = paperParams(preset);
  const shared = exportSettings({ ...preset, imageData: image });
  const imported = parseSettings(shared);
  expect(shared).not.toContain('file:///');
  expect(shared).not.toContain('/home/sender');
  expect(imported).toEqual({
    shader: preset.shader,
    params: { ...original, image },
  });
  expect(paperParams(preset)).toEqual(original);
  expect(() => exportSettings(preset)).toThrow('embedded PNG');
});

test('embedded settings larger than the former 128 KB limit round-trip', () => {
  const largeImage = `data:image/png;base64,${Buffer.alloc(256 * 1024).toString('base64')}`;
  const shared = exportSettings({ ...preset, imageData: largeImage });
  expect(shared.length).toBeGreaterThan(128_000);
  expect(parseSettings(shared).params.image).toBe(largeImage);
  expect(
    parseSettings(`<ImageDithering image={${JSON.stringify(image)}} />`).params
      .image,
  ).toBe(image);
});

test('sample, removed images and legacy local settings remain importable', () => {
  for (const source of ['', 'sample', preset.image]) {
    const settings = JSON.stringify({
      format: 'wallshader-paper',
      version: 1,
      shader: preset.shader,
      params: { image: source },
    });
    expect(parseSettings(settings).params.image).toBe(source);
    if (source !== preset.image)
      expect(
        parseSettings(
          exportSettings(fromPaperParams(preset.id, { image: source })),
        ).params.image,
      ).toBe(source);
  }
});

test('import rejects malformed embedded images, image values and oversized settings', () => {
  for (const source of [
    null,
    false,
    12,
    {},
    'data:image/png;base64,',
    'data:image/png;base64,AAAA=',
    'data:image/png;base64,AA=A',
    'data:image/png;base64,AA A',
    'data:image/png;base64,!!!!',
    'data:image/svg+xml;base64,AAAA',
    'data:text/html;base64,AAAA',
    'https://example.com/image.png',
  ]) {
    const settings = JSON.stringify({
      format: 'wallshader-paper',
      version: 1,
      shader: preset.shader,
      params: { image: source },
    });
    expect(() => parseSettings(settings)).toThrow();
  }
  expect(() => parseSettings(' '.repeat(MAX_SETTINGS_LENGTH + 1))).toThrow(
    '45 MB',
  );
  const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1) / 3) * 4)}`;
  expect(() => embeddedImagePayload(oversized)).toThrow('32 MB');
});

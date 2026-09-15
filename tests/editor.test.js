import { test, expect } from 'bun:test';
import {
  SHADERS,
  PRESETS,
  COMMON_FIELDS,
  createPreset,
  normalizePreset,
  fromPaperParams,
  paperParams,
  presetIdForShader,
  isColor,
} from '../src/catalog.js';
import { exportSettings, parseSettings, paperCode } from '../src/sharing.js';

test('every upstream shader and preset retains all exposed parameters', () => {
  expect(Object.keys(SHADERS)).toHaveLength(30);
  for (const [id, shader] of Object.entries(SHADERS)) {
    expect(presetIdForShader(id)).toBeDefined();
    const controlled = new Set([
      ...shader.fields.map((field) => field.key),
      ...COMMON_FIELDS.map((field) => field.key),
      'colors',
      'fit',
      'image',
      'noiseTexture',
    ]);
    for (const rule of Object.values(shader.rules))
      expect(controlled.has(rule.key)).toBe(true);
    for (const preset of shader.presets) {
      const state = fromPaperParams(presetIdForShader(id), preset.params);
      const params = paperParams(state);
      for (const [key, value] of Object.entries(preset.params))
        expect({ shader: id, key, value: params[key] }).toEqual({
          shader: id,
          key,
          value,
        });
    }
  }
});

test('Paper controls accept full ranges, reverse speed and independent background colors', () => {
  const state = normalizePreset('ribbon', {
    colors: ['#f008', 'rgba(10, 20, 30, 0.5)'],
    speed: -3,
    scale: 0.01,
    offsetX: -1,
    offsetY: 1,
    fit: 'cover',
    frame: 23456,
    params: {
      bandCount: 15,
      center: 0.8,
      proportion: 0.2,
      noise: 0.9,
      colorBack: '#122334',
    },
  });
  expect(state.colors).toHaveLength(2);
  expect(state.params.colorBack).toBe('#122334');
  expect(state.speed).toBe(-3);
  expect(state.params.bandCount).toBe(15);
  expect(state.offsetX).toBe(-1);
  expect(state.fit).toBe('cover');
  expect(state.frame).toBe(23456);
  expect(
    normalizePreset('aurora', { colors: Array(11).fill('#fff') }).colors,
  ).toEqual(createPreset('aurora').colors);
  expect(normalizePreset('aurora', { colors: [] }).colors).toEqual(
    createPreset('aurora').colors,
  );
});

test('all shaders round-trip through copied settings and Paper code without executing code', () => {
  for (const preset of PRESETS) {
    const state = createPreset(preset.id);
    for (const source of [
      exportSettings(state),
      paperCode(state, { width: 1920, height: 1080 }),
    ]) {
      const imported = parseSettings(source);
      expect(imported.shader).toBe(state.shader);
      expect(paperParams(fromPaperParams(state.id, imported.params))).toEqual(
        paperParams(state),
      );
    }
  }
  expect(() =>
    parseSettings('<MeshGradient speed={alert("bad")} />'),
  ).toThrow();
  expect(() => parseSettings('<UnknownShader speed={1} />')).toThrow();
  expect(() =>
    parseSettings(
      '{"format":"wallshader-paper","version":1,"shader":"__proto__","params":{}}',
    ),
  ).toThrow();
});

test('color fields reject CSS injection while supporting Paper color formats', () => {
  for (const value of [
    '#fff',
    '#ffff',
    '#123456',
    '#12345680',
    'rgb(10, 20, 30)',
    'hsla(200, 40%, 60%, 0.5)',
  ])
    expect(isColor(value)).toBe(true);
  for (const value of [
    '#12345',
    '#000; background:red',
    'var(--color)',
    'url(file:///secret)',
    null,
    [1, 2, 3],
  ])
    expect(isColor(value)).toBe(false);
});

test('removing an image survives settings and code round trips', () => {
  const state = fromPaperParams('paper-image-dithering', { image: '' });
  for (const source of [
    exportSettings(state),
    paperCode(state, { width: 640, height: 360 }),
  ]) {
    const imported = parseSettings(source);
    expect(fromPaperParams(state.id, imported.params).image).toBe('');
  }
});

test('Paper site snippets accept shorthand booleans and its CMYK component spelling', () => {
  const parsed = parseSettings(
    '<ImageDithering width={1280} height={720} originalColors inverted={false} />',
  );
  expect(parsed.params.originalColors).toBe(true);
  expect(parsed.params.inverted).toBe(false);
  expect(parseSettings('<HalftoneCMYK size={0.5} />').shader).toBe(
    'halftone-cmyk',
  );
  expect(() => parseSettings('<MeshGradient speed />')).toThrow();
});

import { test, expect } from 'bun:test';
import * as Paper from '@paper-design/shaders';
import {
  SHADERS,
  PRESETS,
  COMMON_FIELDS,
  createPreset,
  normalizePreset,
  normalizeState,
  fromPaperParams,
  paperParams,
  presetIdForShader,
  isColor,
} from '../src/catalog.js';
import { exportSettings, parseSettings, paperCode } from '../src/sharing.js';

test('every upstream shader and preset retains all exposed parameters', () => {
  expect(Object.keys(SHADERS)).toHaveLength(30);
  const exports = new Map(Object.entries(Paper));
  for (const [id, shader] of Object.entries(SHADERS)) {
    expect(presetIdForShader(id)).toBeDefined();
    if (/uniform sampler2D u_noiseTexture\b/.test(exports.get(shader.fragment)))
      expect(shader.rules.u_noiseTexture).toEqual({
        key: 'noiseTexture',
        type: 'noise',
      });
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

test('Paper Texture 0.0.81 settings retain clipping, negative distortion and new controls', () => {
  const { params } = parseSettings(
    '<PaperTexture clip distortion={-0.5} colorPaper={"#abcdef80"} colorShadow={"#123456"} crumpleCount={15} wrinkleSize={0} foldOffsetX={0.75} />',
  );
  const preset = fromPaperParams('paper-paper-texture', params);
  for (const [key, value] of Object.entries(params))
    expect(preset.params[key]).toBe(value);
  expect(preset.params).not.toHaveProperty('colorFront');
  expect(normalizePreset(preset.id, preset)).toEqual(preset);
  expect(
    normalizePreset(preset.id, { params: { crumpleCount: 3.8 } }).params
      .crumpleCount,
  ).toBe(4);
});

test('legacy Paper Texture saved settings and imports migrate once using upstream mappings', () => {
  const id = 'paper-paper-texture';
  const params = {
    colorFront: '#0008',
    colorBack: '#fff8',
    contrast: 0.25,
    fade: 0.4,
    folds: 0.8,
    foldCount: 9,
    crumples: 0.7,
    crumpleSize: 0.5,
    roughness: 0.4,
    fiber: 0.3,
    fiberSize: 0.2,
    drops: 0.2,
    seed: 42,
  };
  const original = {
    id,
    shader: 'paper-texture',
    params,
    image: 'sample',
    scale: 1.7,
  };
  const copy = structuredClone(original);
  const state = normalizeState({
    presets: { [id]: original },
    savedPresets: [{ id: 'old-paper', name: 'Old paper', preset: original }],
  });
  const migrated = state.presets[id];
  expect(state.savedPresets[0].preset).toEqual(migrated);
  expect(
    fromPaperParams(id, { ...params, image: 'sample', scale: 1.7 }),
  ).toEqual(migrated);
  expect(migrated.params.colorShadow).toBe('#0008');
  expect(migrated.params.colorPaper).toBe('#e6e6e688');
  expect(migrated.params.blending).toBe(0.5);
  expect(migrated.params.folds).toBe(0);
  expect(migrated.params.crumples).toBeCloseTo(0.72);
  expect(migrated.params.crumpleCount).toBe(9);
  expect(migrated.params.wrinkles).toBeCloseTo(0.6);
  expect(migrated.params.seed).toBe(42);
  expect(migrated.image).toBe('sample');
  expect(migrated.scale).toBe(1.7);
  expect(normalizeState(state)).toEqual(state);
  expect(original).toEqual(copy);
});

test('legacy Paper Texture migration validates malformed values and retains CSS colors', () => {
  const preset = fromPaperParams('paper-paper-texture', {
    contrast: Number.NaN,
    fade: -10,
    crumpleSize: 0,
    fiberSize: 'bad',
    foldCount: Number.POSITIVE_INFINITY,
    colorFront: 'rgba(10, 20, 30, 0.5)',
    colorBack: 'hsl(200, 40%, 60%)',
  });
  expect(preset.params.colorShadow).toBe('rgba(10, 20, 30, 0.5)');
  expect(preset.params.colorPaper).toBe('hsl(200, 40%, 60%)');
  for (const field of SHADERS['paper-texture'].fields) {
    if (field.type !== 'number') continue;
    expect(preset.params[field.key]).toBeGreaterThanOrEqual(field.min);
    expect(preset.params[field.key]).toBeLessThanOrEqual(field.max);
  }
});

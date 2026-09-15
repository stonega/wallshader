import { test, expect } from 'bun:test';
import {
  PRESETS,
  SHADERS,
  createPreset,
  normalizePreset,
  normalizeState,
  filterPresets,
  validateDimensions,
} from '../src/catalog.js';

test('every wallpaper has a known shader and isolated editable colors', () => {
  expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
  for (const preset of PRESETS) {
    expect(SHADERS[preset.shader]).toBeDefined();
    const edited = createPreset(preset.id);
    edited.colors[0] = '#000000';
    expect(createPreset(preset.id).colors).toEqual(preset.colors);
    expect(normalizePreset(preset.id, createPreset(preset.id))).toEqual(
      createPreset(preset.id),
    );
  }
});

test('corrupt or old settings recover without invalid shader input', () => {
  const state = normalizeState({
    selected: '../unknown',
    favorites: ['moss', 'moss', 'missing'],
    presets: {
      aurora: {
        colors: ['red'],
        scale: -2,
        speed: Infinity,
        params: { distortion: 70, grainOverlay: -1 },
      },
    },
  });
  expect(state.selected).toBe('aurora');
  expect(state.favorites).toEqual(['moss']);
  expect(state.presets.aurora.scale).toBe(0.01);
  expect(state.presets.aurora.speed).toBe(0.25);
  expect(state.presets.aurora.colors).toEqual(PRESETS[0].colors);
  expect(state.presets.aurora.params.distortion).toBe(1);
  expect(state.presets.aurora.params.grainOverlay).toBe(0);
  for (const input of [null, false, 'bad', [], 12])
    expect(normalizeState(input).selected).toBe('aurora');
});

test('saved custom settings round-trip with shader-specific integer controls', () => {
  const custom = createPreset('ribbon');
  custom.colors = ['#112233', '#aabbcc', '#123abc', '#fedcba'];
  custom.params.bandCount = 2.7;
  const saved = normalizeState(
    JSON.parse(
      JSON.stringify({ selected: 'ribbon', presets: { ribbon: custom } }),
    ),
  );
  expect(saved.presets.ribbon.colors).toEqual(custom.colors);
  expect(saved.presets.ribbon.params.bandCount).toBe(3);
});

test('debug info is opt-in and survives state normalization', () => {
  for (const debugInfo of [undefined, null, 'true', 1, false])
    expect(normalizeState({ debugInfo }).debugInfo).toBe(false);
  const state = normalizeState({ debugInfo: true });
  expect(normalizeState(JSON.parse(JSON.stringify(state))).debugInfo).toBe(
    true,
  );
});

test('filters compose category, favorite status and case-insensitive search', () => {
  expect(filterPresets('Favorites', '', [])).toEqual([]);
  expect(
    filterPresets('Favorites', 'MoSS', ['moss']).map((item) => item.id),
  ).toEqual(['moss']);
  expect(filterPresets('Gradients', 'simplex', []).length).toBe(0);
  expect(filterPresets('All', 'simplex', []).map((item) => item.id)).toEqual([
    'tidal',
    'contour',
  ]);
  expect(
    filterPresets('Patterns', '  ', []).every(
      (preset) => SHADERS[preset.shader].category === 'Patterns',
    ),
  ).toBe(true);
});

test('capture dimensions allow monitor formats but reject excessive allocations', () => {
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
    [3440, 1440],
    [2160, 3840],
    [7680, 4320],
  ])
    expect(validateDimensions(width, height)).toEqual({ width, height });
  for (const [width, height] of [
    [0, 1080],
    [-1, 5],
    [1.5, 5],
    [8193, 100],
    [8192, 8192],
    [NaN, 40],
  ])
    expect(() => validateDimensions(width, height)).toThrow();
});

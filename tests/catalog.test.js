import { test, expect } from 'bun:test';
import {
  PRESETS,
  SHADERS,
  createPreset,
  normalizePreset,
  normalizeState,
  filterPresets,
  addFavorite,
  recordRecent,
  presetFingerprint,
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
  expect(state.favorites).toEqual([
    { name: 'Original', preset: createPreset('moss') },
  ]);
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

test('GPU wallpaper rendering is opt-in and survives saved state', () => {
  for (const liveRendering of [undefined, null, true, 1, 'GPU', 'unknown'])
    expect(normalizeState({ liveRendering }).liveRendering).toBe(
      'compatibility',
    );
  const state = normalizeState({ liveRendering: 'gpu' });
  expect(normalizeState(JSON.parse(JSON.stringify(state))).liveRendering).toBe(
    'gpu',
  );
});

test('filters compose category and case-insensitive search', () => {
  expect(
    filterPresets('Image Filters', 'simplex').map((item) => item.id),
  ).toEqual([]);
  expect(filterPresets('Effects', 'simplex').map((item) => item.id)).toEqual([
    'tidal',
    'contour',
  ]);
  expect(filterPresets('All', 'simplex').map((item) => item.id)).toEqual([
    'tidal',
    'contour',
  ]);
  expect(
    filterPresets('Image Filters', '  water  ').map((item) => item.id),
  ).toEqual(['paper-water']);
  expect(
    filterPresets('Logo Animations', 'metal').map((item) => item.id),
  ).toEqual(['paper-liquid-metal']);
});

test('favorites keep exact presets and recent applies deduplicate across destinations', () => {
  const original = createPreset('aurora');
  const edited = { ...original, scale: 1.75 };
  const favorites = addFavorite(
    addFavorite([], original, 'Original'),
    edited,
    'Custom',
  );
  expect(favorites).toHaveLength(2);
  expect(favorites[0].preset.scale).toBe(1.75);
  expect(favorites[1].name).toBe('Original');
  expect(presetFingerprint(favorites[0].preset)).not.toBe(
    presetFingerprint(favorites[1].preset),
  );
  const recent = recordRecent(
    recordRecent([], edited, 'Custom', 'desktop'),
    edited,
    'Custom',
    'kitty',
  );
  expect(recent).toHaveLength(1);
  expect(recent[0].target).toBe('kitty');
  expect(normalizeState({ version: 3, favorites, recent }).recent).toEqual(
    recent,
  );
  expect(normalizeState({ version: 3, favorites, recent }).favorites).toEqual(
    favorites,
  );
  expect(
    normalizeState({ version: 2, favorites: [...favorites].reverse() })
      .favorites,
  ).toEqual(favorites);
  expect(
    normalizeState({ version: 2, favorites: ['aurora', 'moss'] }).favorites.map(
      (item) => item.preset.id,
    ),
  ).toEqual(['moss', 'aurora']);
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

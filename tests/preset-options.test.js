import { expect, test } from 'bun:test';
import { createPreset, normalizeState } from '../src/catalog.js';
import {
  presetFingerprint,
  presetOptions,
  randomPresetName,
  selectedPresetKey,
} from '../src/preset-options.js';

test('random hex names avoid case-insensitive collisions within a shader', () => {
  const preset = createPreset('moss');
  const savedPresets = [
    { name: '#fffffe', preset },
    { name: '#FFFFFF', preset },
    { name: '#000000', preset: createPreset('ribbon') },
  ];
  expect(randomPresetName(preset, [], () => 0)).toBe('#000000');
  expect(randomPresetName(preset, [], () => 0xa3f07c / 0x1000000)).toBe(
    '#A3F07C',
  );
  expect(
    randomPresetName(preset, savedPresets, () => 0xfffffe / 0x1000000),
  ).toBe('#000000');
});

test('named configurations survive restart without sharing mutable settings', () => {
  const preset = createPreset('moss');
  preset.colors = ['#12345678', '#abcdef'];
  preset.speed = -2;
  preset.frame = 1250;
  preset.params.distortion = 0.47;
  const state = normalizeState(
    JSON.parse(
      JSON.stringify({
        version: 2,
        selected: 'moss',
        presets: { moss: preset },
        savedPresets: [{ id: 'saved-1', name: '  My forest  ', preset }],
      }),
    ),
  );
  expect(state.savedPresets[0].name).toBe('My forest');
  expect(state.savedPresets[0].preset).toEqual(preset);
  state.presets.moss.colors[0] = '#ffffff';
  expect(state.savedPresets[0].preset.colors[0]).toBe('#12345678');
  expect(normalizeState({ version: 2 }).savedPresets).toEqual([]);
});

test('invalid named configurations are dropped while valid siblings recover', () => {
  const valid = { id: 'saved-1', name: 'Forest', preset: createPreset('moss') };
  const state = normalizeState({
    savedPresets: [
      null,
      {},
      { ...valid, id: '../outside' },
      { ...valid, name: '  ' },
      { ...valid, preset: { ...valid.preset, shader: 'missing' } },
      { ...valid, preset: { ...valid.preset, id: 'missing' } },
      valid,
      valid,
      { ...valid, id: 'saved-2', preset: { ...valid.preset, scale: Infinity } },
    ],
  });
  expect(state.savedPresets.map((item) => item.id)).toEqual([
    'saved-1',
    'saved-2',
  ]);
  expect(state.savedPresets[1].preset.scale).toBe(1);
  expect(normalizeState({ savedPresets: {} }).savedPresets).toEqual([]);
});

test('the grid includes saved settings for the current shader across wallpaper templates', () => {
  const saved = { id: 'saved-1', name: 'Forest', preset: createPreset('moss') };
  const options = presetOptions(createPreset('aurora'), [
    saved,
    { id: 'saved-2', name: 'Ribbon', preset: createPreset('ribbon') },
  ]);
  const restored = options.find((option) => option.savedId);
  expect(options.filter((option) => option.savedId)).toHaveLength(1);
  expect(restored.name).toBe('Forest');
  expect(restored.preset.id).toBe('aurora');
  expect(presetFingerprint(restored.preset)).toBe(
    presetFingerprint(saved.preset),
  );
  restored.preset.colors[0] = '#ffffff';
  expect(saved.preset.colors[0]).not.toBe('#ffffff');
});

test('selection follows exact settings and distinguishes the chosen identical preset', () => {
  const preset = createPreset('aurora');
  const options = presetOptions(preset, [
    { id: 'saved-1', name: 'Copy', preset },
  ]);
  expect(selectedPresetKey(options, preset, 'default')).toBe('default');
  expect(selectedPresetKey(options, preset, 'saved:saved-1')).toBe(
    'saved:saved-1',
  );
  expect(selectedPresetKey(options, preset)).toBe('saved:saved-1');
  expect(selectedPresetKey(options, { ...preset, speed: -7 })).toBeNull();
  const variant = options.find((option) => option.key === 'paper:1');
  expect(selectedPresetKey(options, variant.preset)).toBe('paper:1');
});

test('Paper previews retain the current image while saved configurations restore their own', () => {
  const preset = createPreset('paper-image-dithering');
  preset.image = 'file:///tmp/current.png';
  const saved = {
    id: 'saved-image',
    name: 'Old image',
    preset: { ...preset, image: 'file:///tmp/saved.png' },
  };
  const options = presetOptions(preset, [saved]);
  expect(
    options
      .filter((option) => option.key.startsWith('paper:'))
      .every((option) => option.preset.image === preset.image),
  ).toBe(true);
  expect(options.at(-1).preset.image).toBe('file:///tmp/saved.png');
  expect(options[0].preset.image).toBe('sample');
});

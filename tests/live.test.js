import { test, expect } from 'bun:test';
import { createPreset, PRESETS } from '../src/catalog.js';
import {
  normalizeLiveConfig,
  parseLiveConfig,
  coversMonitor,
  rendererIdentity,
} from '../src/live-config.js';

test('live settings preserve every shader and bound rendering options', () => {
  for (const { id } of PRESETS) {
    const preset = createPreset(id);
    expect(
      parseLiveConfig(
        JSON.stringify({ preset, enabled: true, paused: true, fps: 60 }),
      ),
    ).toEqual({
      version: 1,
      enabled: true,
      paused: true,
      fps: 60,
      rendering: 'compatibility',
      backend: 'native',
      preset,
    });
  }
  const safe = normalizeLiveConfig({
    preset: createPreset('aurora'),
    fps: 9000,
    enabled: 'yes',
  });
  expect(safe.enabled).toBe(false);
  expect(safe.fps).toBe(30);
  expect(() => parseLiveConfig('{bad')).toThrow();
  expect(() => normalizeLiveConfig({ preset: { id: 'unknown' } })).toThrow();
  expect(() => parseLiveConfig('x'.repeat(128001))).toThrow();
});

test('renderer backend is restricted and has a sandbox-compatible identity', () => {
  const preset = createPreset('aurora');
  expect(normalizeLiveConfig({ preset, backend: 'flatpak' }).backend).toBe(
    'flatpak',
  );
  for (const backend of [
    undefined,
    null,
    'native',
    'arbitrary-command',
    {},
    true,
  ])
    expect(normalizeLiveConfig({ preset, backend }).backend).toBe('native');
  expect(rendererIdentity('native')).toEqual({
    id: 'io.github.wallshader.Renderer',
    path: '/io/github/wallshader/Renderer',
  });
  expect(rendererIdentity('flatpak')).toEqual({
    id: 'io.github.stonega.wallshader.Renderer',
    path: '/io/github/stonega/wallshader/Renderer',
  });
});

test('live rendering survives persistence and older settings keep compatibility', () => {
  const preset = createPreset('aurora');
  for (const rendering of ['gpu', 'compatibility']) {
    const config = normalizeLiveConfig({ preset, rendering });
    expect(parseLiveConfig(JSON.stringify(config)).rendering).toBe(rendering);
  }
  for (const rendering of [undefined, null, true, 1, 'GPU', 'unknown', {}])
    expect(normalizeLiveConfig({ preset, rendering }).rendering).toBe(
      'compatibility',
    );
});

test('coverage respects negative monitor origins and partially visible desktops', () => {
  const monitor = { x: -1920, y: 100, width: 1920, height: 1080 };
  expect(coversMonitor({ ...monitor }, monitor)).toBe(true);
  expect(coversMonitor({ ...monitor, height: 1000 }, monitor)).toBe(false);
  expect(
    coversMonitor({ x: 0, y: 0, width: 1920, height: 1080 }, monitor),
  ).toBe(false);
  expect(
    coversMonitor({ x: -2000, y: 0, width: 3000, height: 1400 }, monitor),
  ).toBe(true);
});

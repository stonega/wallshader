import { test, expect } from 'bun:test';
import { createPreset, PRESETS } from '../src/catalog.js';
import {
  normalizeLiveConfig,
  parseLiveConfig,
  coversMonitor,
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
      resolution: { width: 1920, height: 1080 },
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

test('live resolution survives persistence and older settings retain 1080p', () => {
  const preset = createPreset('aurora');
  expect(normalizeLiveConfig({ preset }).resolution).toEqual({
    width: 1920,
    height: 1080,
  });
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
    [3440, 1440],
    [7680, 4320],
    [2160, 3840],
  ]) {
    const resolution = { width, height };
    const config = normalizeLiveConfig({ preset, resolution });
    expect(parseLiveConfig(JSON.stringify(config)).resolution).toEqual(
      resolution,
    );
    expect(config.resolution).not.toBe(resolution);
  }
  for (const resolution of [
    null,
    {},
    { width: 0, height: 1080 },
    { width: '3840', height: 2160 },
    { width: 3840.5, height: 2160 },
    { width: 8193, height: 1080 },
    { width: 8192, height: 8192 },
  ])
    expect(() => normalizeLiveConfig({ preset, resolution })).toThrow();
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

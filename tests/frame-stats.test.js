import { expect, test } from 'bun:test';
import { createFrameStats } from '../src/renderer/frame-stats.js';

test('counts changed frames at 30 fps on a 60 Hz display, including reverse playback', () => {
  for (const direction of [1, -1]) {
    const stats = createFrameStats(0, 0);
    for (let tick = 1; tick <= 60; tick++)
      stats.observe(Math.floor(tick / 2) * direction);
    expect(stats.snapshot(1000)).toEqual({
      fps: 30,
      frameInterval: 1000 / 30,
      total: 30,
    });
    expect(stats.snapshot(2000)).toEqual({
      fps: 0,
      frameInterval: null,
      total: 30,
    });
  }
});

test('stalls reduce observed FPS and identical or missing frames do not count', () => {
  const stats = createFrameStats(100, 5);
  stats.observe(5);
  stats.observe(undefined);
  stats.observe(Number.NaN);
  expect(stats.snapshot(100)).toEqual({
    fps: 0,
    frameInterval: null,
    total: 0,
  });
  stats.observe(8000);
  expect(stats.snapshot(2100)).toEqual({
    fps: 0.5,
    frameInterval: 2000,
    total: 1,
  });
});

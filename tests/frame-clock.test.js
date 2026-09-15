import { expect, test } from 'bun:test';
import { createFrameClock } from '../src/renderer/frame-clock.js';

test('caps 30/60 fps playback to repaint cadence without changing animation speed', () => {
  for (const fps of [30, 60]) {
    for (const refresh of [30, 60, 120, 144]) {
      const advance = createFrameClock(fps, 0);
      let draws = 0;
      let elapsed = 0;
      for (let repaint = 0; repaint <= refresh * 10; repaint++) {
        const delta = advance((repaint * 1000) / refresh);
        if (delta > 0) draws++;
        elapsed += delta;
      }
      expect(draws).toBe(Math.min(fps, refresh) * 10);
      expect(elapsed).toBeCloseTo(10000, 5);
    }
  }
});

test('jitter near display boundaries does not halve the requested frame rate', () => {
  const advance = createFrameClock(60, 0);
  let draws = 0;
  let elapsed = 0;
  for (let repaint = 1; repaint <= 600; repaint++) {
    const delta = advance((repaint * 1000) / 60 + (repaint % 2 ? -0.2 : 0.2));
    if (delta > 0) draws++;
    elapsed += delta;
  }
  expect(draws).toBe(600);
  expect(elapsed).toBeCloseTo(10000.2, 5);
});

test('a delayed repaint advances once and never queues catch-up draws', () => {
  const advance = createFrameClock(30, 0);
  expect(advance(100)).toBe(100);
  expect(advance(100)).toBe(0);
  expect(advance(101)).toBe(0);
  expect(advance(133.333)).toBeCloseTo(33.333, 3);
  expect(advance(2000)).toBe(1000);
  expect(advance(2000)).toBe(0);
  expect(advance(2010)).toBe(0);
  expect(advance(2033.333)).toBeCloseTo(33.333, 3);
});

test('restarting playback discards time spent paused', () => {
  const advance = createFrameClock(60, 90000);
  expect(advance(89999)).toBe(0);
  expect(advance(90000)).toBe(0);
  expect(advance(90016.667)).toBeCloseTo(16.667, 3);
});

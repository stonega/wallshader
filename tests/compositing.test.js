import { expect, test } from 'bun:test';
import { CompositingHold } from '../extension/compositing.js';

test('repeated visibility updates and cleanup balance Mutter inhibitor references', () => {
  let references = 0;
  const compositor = {
    disable_unredirect() {
      references++;
    },
    enable_unredirect() {
      expect(references).toBeGreaterThan(0);
      references--;
    },
  };
  const wallpaper = new CompositingHold(compositor);
  const recording = new CompositingHold(compositor);
  recording.setRequired(true);
  for (let restart = 0; restart < 3; restart++) {
    for (let update = 0; update < 20; update++) wallpaper.setRequired(true);
    expect(references).toBe(2);
    wallpaper.setRequired(false);
    expect(references).toBe(1);
    wallpaper.setRequired(false);
    expect(references).toBe(1);
  }
  recording.setRequired(false);
  expect(references).toBe(0);
});

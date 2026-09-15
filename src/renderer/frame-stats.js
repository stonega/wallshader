// Observe animation-time changes without modifying Paper's render loop. These
// count frames seen by rAF, not GPU completions or compositor presentation.
export function createFrameStats(start, frame) {
  let previous = frame;
  let since = start;
  let count = 0;
  let total = 0;
  return {
    observe(value) {
      if (!Number.isFinite(value) || value === previous) return;
      previous = value;
      count++;
      total++;
    },
    snapshot(now) {
      const elapsed = now - since;
      const fps = elapsed > 0 ? (count * 1000) / elapsed : 0;
      const result = { fps, frameInterval: fps > 0 ? 1000 / fps : null, total };
      since = now;
      count = 0;
      return result;
    },
  };
}

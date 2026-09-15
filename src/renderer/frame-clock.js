// Pace drawing against the browser's repaint timestamps. Missed display frames
// advance time once, instead of queuing extra draws to catch up.
export function createFrameClock(fps, start) {
  const interval = 1000 / fps;
  let previous = start;
  let tick = 0;
  return (now) => {
    // Repaint timestamps can fall just before a nominal display boundary.
    const nextTick = Math.floor((now - start + 0.5) / interval);
    if (nextTick <= tick) return 0;
    tick = nextTick;
    const elapsed = Math.min(now - previous, 1000);
    previous = now;
    return elapsed;
  };
}

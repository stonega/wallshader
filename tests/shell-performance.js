import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { createPreset } from '../wallshader@wallshader.github.io/app/src/catalog.js';
import { Store } from '../wallshader@wallshader.github.io/app/src/storage.js';

const now = () => GLib.get_monotonic_time() / 1000;
const delay = (ms) =>
  new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    }),
  );

function p95(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
}

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(100);
  }
  throw new Error('Performance test: renderer did not settle');
}

async function measure(label) {
  const samples = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const [action, trigger] of [
      ['overview-open', () => Main.overview.show()],
      ['overview-close', () => Main.overview.hide()],
      ['apps-open', () => Main.overview.showApps()],
      ['apps-close', () => Main.overview.hide()],
    ]) {
      const frames = [];
      const start = now();
      const signal = global.stage.connect('after-paint', () =>
        frames.push(now() - start),
      );
      try {
        trigger();
        await delay(350);
      } finally {
        global.stage.disconnect(signal);
      }
      if (frames.length < 2)
        throw new Error(`Performance test: ${action} did not paint`);
      samples.push({ action, repeat, frames });
      await delay(100);
    }
  }
  const intervals = samples.flatMap(({ frames }) =>
    frames
      .slice(1)
      .flatMap((frame, i) => (frame <= 250 ? [frame - frames[i]] : [])),
  );
  if (!intervals.length)
    throw new Error('Performance test: animation stalled before painting');
  const result = {
    ...label,
    p95Ms: p95(intervals),
    over20ms: intervals.filter((interval) => interval > 20).length,
    over25ms: intervals.filter((interval) => interval > 25).length,
    intervals: intervals.length,
    firstPaintP95Ms: p95(samples.map(({ frames }) => frames[0])),
    samples,
  };
  console.log(
    `Shell animation timing: ${JSON.stringify({ ...result, samples: undefined })}`,
  );
  return result;
}

export async function checkPerformance(extension) {
  if (!GLib.get_user_config_dir().includes('wallshader-shell-test.'))
    throw new Error('Performance tests require an isolated desktop');
  const store = new Store();
  store.state.selected = 'dusk';
  store.save();
  new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' }).set_boolean(
    'enable-animations',
    true,
  );
  new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' }).set_int(
    'num-workspaces',
    2,
  );
  const background = new Gio.Settings({
    schema_id: 'org.gnome.desktop.background',
  });
  background.set_string('picture-uri', '');
  background.set_string('picture-uri-dark', '');
  background.set_string('picture-options', 'none');
  background.set_string('primary-color', '#303030');
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.NONE,
  });
  launcher.setenv(
    'WAYLAND_DISPLAY',
    GLib.getenv('WALLSHADER_TEST_DISPLAY'),
    true,
  );
  const editor = launcher.spawnv([
    'gjs',
    '-m',
    `${GLib.getenv('WALLSHADER_TEST_APP_DIR')}/src/main.js`,
  ]);
  const results = [];
  try {
    // Let preview shaders, thumbnails and app-grid icons finish their cold work.
    await delay(20000);
    if (
      !global
        .get_window_actors()
        .some(
          (actor) =>
            actor.meta_window.get_wm_class() ===
            'io.github.wallshader.Wallshader',
        )
    )
      throw new Error(
        'Performance test: editor did not open on the private display',
      );
    Main.overview.showApps();
    await delay(700);
    Main.overview.hide();
    await delay(700);
    extension.Stop();
    await until(() => !extension._process && !extension._stopping);
    results.push(await measure({ state: 'stopped-before' }));
    for (const rendering of ['compatibility', 'gpu']) {
      for (const fps of [30, 60]) {
        extension.Apply(
          JSON.stringify({ preset: createPreset('dusk'), fps, rendering }),
        );
        await until(() => extension._ready && extension._windows.size === 1);
        await delay(1500);
        for (const paused of [false, true]) {
          extension.SetPaused(paused);
          await delay(500);
          results.push(
            await measure({
              state: paused ? 'paused' : 'playing',
              rendering,
              fps,
            }),
          );
        }
      }
    }
    extension.Stop();
    await until(() => !extension._process && !extension._stopping);
    await delay(600);
    results.push(await measure({ state: 'stopped-after' }));
  } finally {
    extension.Stop();
    Main.overview.hide();
    editor.send_signal(15);
  }
  // Keep the stopped baseline for diagnosis, and enforce the 20 ms target for
  // every live configuration without widening it when the desktop is busy.
  const baseline = Math.max(results[0].p95Ms, results.at(-1).p95Ms);
  const budget = 20;
  const firstPaintBudget = Math.max(
    100,
    2 * Math.max(results[0].firstPaintP95Ms, results.at(-1).firstPaintP95Ms),
  );
  const report = {
    method:
      'Compositor after-paint intervals in the first 250ms of each transition; virtual display, not physical presentation feedback',
    monitors: Main.layoutManager.monitors.map(({ width, height }) => ({
      width,
      height,
    })),
    budgetMs: budget,
    firstPaintBudgetMs: firstPaintBudget,
    results,
  };
  Gio.File.new_for_path(
    `${GLib.getenv('WALLSHADER_ARTIFACTS')}/shell-performance.json`,
  ).replace_contents(
    new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  );
  for (const result of results.slice(1, -1)) {
    if (result.p95Ms > budget)
      throw new Error(
        `Shell timing regression: ${result.state} ${result.rendering} ${result.fps}fps P95=${result.p95Ms.toFixed(1)}ms exceeds ${budget.toFixed(1)}ms (baseline ${baseline.toFixed(1)}ms)`,
      );
    if (result.firstPaintP95Ms > firstPaintBudget)
      throw new Error(
        `Shell entry stalled: ${result.state} ${result.rendering} ${result.fps}fps first-paint P95=${result.firstPaintP95Ms.toFixed(1)}ms exceeds ${firstPaintBudget.toFixed(1)}ms`,
      );
  }
}

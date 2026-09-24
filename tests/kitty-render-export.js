import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Preview } from '../src/preview.js';
import { PRESETS, normalizePreset } from '../src/catalog.js';
if (!GLib.getenv('WALLSHADER_KITTY_TEST_DIR'))
  throw new Error('Missing isolated test directory');
Gtk.init();
const loop = GLib.MainLoop.new(null, false);
let failed = false;
const preview = new Preview((error) => {
  failed = true;
  printerr(error.message);
  loop.quit();
});
const win = new Gtk.Window({
  default_width: 320,
  default_height: 200,
  child: preview.widget,
});
win.present();
function write(path, data) {
  const f = Gio.File.new_for_path(path);
  try {
    f.get_parent().make_directory_with_parents(null);
  } catch {}
  f.replace_contents(
    new TextEncoder().encode(data),
    null,
    false,
    Gio.FileCreateFlags.NONE,
    null,
  );
}
(async () => {
  await preview.ready;
  await preview.pause(true);
  const seen = new Set();
  const imageCases = ['gem-smoke', 'liquid-metal'].map((shader) => ({
    ...PRESETS.find((p) => p.shader === shader),
    image: 'sample',
    testName: `${shader}-image`,
  }));
  const animationCases = ['neuro-noise', 'god-rays', 'water', 'smoke-ring'].map(
    (shader) => ({
      ...PRESETS.find((p) => p.shader === shader),
      testName: `animation-${shader}`,
    }),
  );
  for (const preset of [...PRESETS, ...imageCases, ...animationCases]) {
    const name = preset.testName ?? preset.shader;
    if (seen.has(name)) continue;
    seen.add(name);
    const state = normalizePreset(preset.id, {
      ...preset,
      speed: name.startsWith('animation-') ? 1 : 0,
      frame: 4000,
    });
    await preview.select(state);
    const png = await preview.request('capture', {
      width: 320,
      height: 200,
      frame: 4000,
    });
    const result = await preview.request('kitty-shader', {
      preset: state,
      fps: 30,
    });
    const dir = `${GLib.getenv('WALLSHADER_KITTY_TEST_DIR')}/${name}`;
    write(`${dir}/wallshader.slang`, result.source);
    for (const [i, s] of result.textures.entries())
      write(`${dir}/wallshader-texture-${i}.slang`, s);
    write(`${dir}/wallshader.pipeline`, result.pipeline);
    write(`${dir}/paper.txt`, png);
    write(`${dir}/preset.json`, JSON.stringify(state));
    print(`Exported ${name}`);
  }
  preview.close();
  win.destroy();
  loop.quit();
})().catch((e) => {
  logError(e);
  failed = true;
  loop.quit();
});
loop.run();
if (failed) imports.system.exit(1);

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {
  PRESETS,
  SHADERS,
  createPreset,
  fromPaperParams,
  presetIdForShader,
  normalizePreset,
} from '../src/catalog.js';
import { importImage } from '../src/images.js';
import { exportSettings } from '../src/sharing.js';
import { showSharingDialog } from '../src/sharing-dialog.js';
import { ROOT } from '../src/paths.js';
import { Store, watchDebugInfo } from '../src/storage.js';
import { pngBytes, savePng } from '../src/wallpaper.js';
import {
  deleteNamedPreset,
  savedPreviewFile,
  saveNamedPreset,
} from '../src/saved-presets.js';
import { presetFingerprint } from '../src/preset-options.js';
import { checkKittyBackground } from './kitty-native.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function settle() {
  return new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 900, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    }),
  );
}

async function screenshot(window, path) {
  const paintable = new Gtk.WidgetPaintable({ widget: window });
  // Resizing a Wayland window may unmap it briefly; wait for a painted allocation.
  for (let attempt = 0; attempt < 5; attempt++) {
    window.queue_draw();
    await settle();
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, window.get_width(), window.get_height());
    const node = snapshot.to_node();
    if (!node) continue;
    const texture = window
      .get_native()
      .get_renderer()
      .render_texture(node, null);
    assert(texture.save_to_png(path), 'Could not save window screenshot');
    return;
  }
  throw new Error('Window snapshot was empty; keep the test window visible.');
}

function checkImage(uri, width, height) {
  const loader = new GdkPixbuf.PixbufLoader();
  loader.write(pngBytes(uri));
  loader.close();
  const image = loader.get_pixbuf();
  assert(
    image.get_width() === width && image.get_height() === height,
    'Export dimensions do not match',
  );
  const pixels = image.get_pixels();
  const colors = new Set();
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 43))) {
      const offset = y * image.get_rowstride() + x * image.get_n_channels();
      colors.add(
        `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${image.get_n_channels() === 4 ? pixels[offset + 3] : 255}`,
      );
    }
  }
  assert(
    colors.size > 1,
    `Shader rendered a blank or flat frame (${colors.size} colors)`,
  );
}

async function checkAnimatedWallpaper(window) {
  const live = window.live;
  const showError = window.showError;
  const request = window.preview.request;
  const apply = window.wallpaper.apply;
  const settings = window.wallpaper.settings;
  const applied = [];
  const errors = [];
  // Exercise the editor and real PNG/GSettings path without contacting Shell.
  window.live = {
    status: { available: true, active: false },
    async apply(preset, fps, rendering) {
      assert(
        !window.liveRendering.sensitive,
        'Rendering control changed during apply',
      );
      applied.push({
        preset,
        fps,
        rendering,
        uri: settings.get_string('picture-uri'),
      });
    },
  };
  window.showError = (error) => errors.push(error.message);
  window.wallpaperMode.selected = 1;
  window.resolution.selected = 1;
  window._paused = true;
  await window.preview.pause(true);
  try {
    for (const [frame, speed, fps, rendering] of [
      [0, 0, 30, 'compatibility'],
      [-8000, -2, 60, 'gpu'],
    ]) {
      window.preset = { ...window.preset, frame, speed };
      window.liveFps.selected = fps === 60 ? 1 : 0;
      window.liveRendering.selected = rendering === 'gpu' ? 1 : 0;
      await window.applyWallpaper();
      assert(errors.length === 0, `Animated apply failed: ${errors}`);
      const result = applied.at(-1);
      assert(
        result?.preset.frame === frame &&
          result.preset.speed === speed &&
          result.fps === fps &&
          result.rendering === rendering,
        'Animated apply lost the starting frame, speed, frame rate, or rendering mode',
      );
      assert(
        result.uri.startsWith(
          Gio.File.new_for_path(GLib.get_user_data_dir()).get_uri(),
        ) &&
          settings.get_string('picture-uri-dark') === result.uri &&
          settings.get_string('picture-options') === 'zoom',
        'Both static backgrounds must be installed before animation starts',
      );
      const [, contents] = Gio.File.new_for_uri(result.uri).load_contents(null);
      const image = `data:image/png;base64,${GLib.base64_encode(contents)}`;
      checkImage(image, 1920, 1080);
      // Move the preview ahead: an explicit capture must still use the first frame.
      await window.preview.select({ ...result.preset, frame: frame + 8000 });
      const expected = await window.preview.request('capture', {
        width: 1920,
        height: 1080,
        frame,
      });
      assert(
        image === expected,
        'Static wallpaper differs from the animation’s first frame',
      );
      assert(window.wallpaper.canRestore, 'Animated apply must enable restore');
      assert(!window._busy, 'Animated apply left the editor busy');
      const saved = new Store().state.savedPresets.find(
        (item) =>
          presetFingerprint(item.preset) === presetFingerprint(result.preset),
      );
      assert(
        saved &&
          /^#[0-9A-F]{6}$/.test(saved.name) &&
          savedPreviewFile(saved.id).query_exists(null) &&
          window.presetGrid.selectedKey === `saved:${saved.id}`,
        'Animated apply did not save and select the applied configuration',
      );
    }
    assert(applied.length === 2, 'Animated reapply did not start animation');
    const savedCount = window.store.state.savedPresets.length;
    await window.applyWallpaper();
    assert(
      applied.length === 3 &&
        window.store.state.savedPresets.length === savedCount,
      'Reapplying a saved animated configuration created a duplicate',
    );
    window.preset = { ...window.preset, scale: 2.15 };
    const previous = settings.get_string('picture-uri');
    window.preview.request = function (method, args) {
      if (method === 'capture')
        return Promise.reject(new Error('Capture failed'));
      return request.call(this, method, args);
    };
    await window.applyWallpaper();
    assert(
      errors.pop() === 'Capture failed',
      'Capture failure was not reported',
    );
    assert(
      applied.length === 3 &&
        settings.get_string('picture-uri') === previous &&
        window.store.state.savedPresets.length === savedCount,
      'A failed capture must not start animation, replace the background, or save a preset',
    );
    window.preview.request = request;
    window.wallpaper.apply = async () => {
      throw new Error('Save failed');
    };
    await window.applyWallpaper();
    assert(
      errors.pop() === 'Save failed',
      'Static wallpaper failure was not reported',
    );
    assert(
      applied.length === 3 &&
        settings.get_string('picture-uri') === previous &&
        window.store.state.savedPresets.length === savedCount,
      'A failed static wallpaper save must not start animation or save a preset',
    );
    window.wallpaper.apply = apply;
    window.live.apply = async () => {
      throw new Error('Animation unavailable');
    };
    await window.applyWallpaper();
    assert(
      errors.pop() === 'Animation unavailable',
      'Animation failure was not reported',
    );
    assert(
      settings.get_string('picture-uri') !== previous &&
        window.wallpaper.canRestore &&
        window.store.state.savedPresets.length === savedCount + 1,
      'Animation failure must leave the static first frame, its preset, and restore backup available',
    );
    assert(
      !window._busy && window.applyButton.sensitive,
      'Failed apply did not restore editor controls',
    );
  } finally {
    window.live = live;
    window.showError = showError;
    window.preview.request = request;
    window.wallpaper.apply = apply;
    window.wallpaperMode.selected = 0;
    window.liveRendering.selected = 0;
    window._syncAvailability();
  }
  console.log(
    'Verified animated first-frame wallpaper, reapply, and failure handling.',
  );
}

async function checkStillWallpaperPresets(window) {
  const live = window.live;
  const showError = window.showError;
  const request = window.preview.request;
  const storePath = window.store.path;
  const errors = [];
  let frame = 4321;
  // Keep every wallpaper operation on isolated GSettings, away from real Shell.
  window.live = { status: { active: false }, async stop() {} };
  window.showError = (error) => errors.push(error.message);
  window.preview.request = function (method, args) {
    if (method === 'state') return Promise.resolve({ frame });
    return request.call(this, method, args);
  };
  window.wallpaperMode.selected = 0;
  try {
    const initialCount = window.store.state.savedPresets.length;
    window.resetPreset();
    await window.applyWallpaper();
    window.selectPaperPreset(1);
    await window.applyWallpaper();
    assert(
      window.store.state.savedPresets.length === initialCount,
      'Applying Original or Paper settings at a later frame added a duplicate preset',
    );
    window.preset.scale = 2.37;
    window._changed();
    await window.applyWallpaper();
    const saved = new Store().state.savedPresets.at(-1);
    assert(
      errors.length === 0 &&
        window.store.state.savedPresets.length === initialCount + 1 &&
        /^#[0-9A-F]{6}$/.test(saved.name) &&
        saved.preset.frame === frame &&
        saved.preset.scale === 2.37 &&
        presetFingerprint(saved.preset) === presetFingerprint(window.preset) &&
        window.presetGrid.selectedKey === `saved:${saved.id}`,
      'Still apply did not save and select the exact captured configuration',
    );
    const [, bytes] = savedPreviewFile(saved.id).load_contents(null);
    const expected = await request.call(window.preview, 'thumbnail', {
      preset: saved.preset,
    });
    assert(
      `data:image/png;base64,${GLib.base64_encode(bytes)}` === expected,
      'Auto-saved thumbnail does not match its captured frame',
    );
    frame = 9876;
    await window.applyWallpaper();
    assert(
      window.store.state.savedPresets.length === initialCount + 1,
      'Reapplying saved still settings after playback advanced added a duplicate',
    );
    // Let the editor's pending save finish before injecting a preset write failure.
    await settle();
    window.preset = { ...window.preset, scale: 3.14 };
    window.store.path = savedPreviewFile(saved.id).get_parent().get_path();
    const previous = window.wallpaper.settings.get_string('picture-uri');
    await window.applyWallpaper();
    assert(
      errors.length === 1 &&
        errors[0].startsWith(
          'Wallpaper applied, but the preset could not be saved:',
        ) &&
        window.store.state.savedPresets.length === initialCount + 1 &&
        window.wallpaper.settings.get_string('picture-uri') !== previous &&
        !window._busy &&
        window.applyButton.sensitive,
      'A preset write failure must be reported while leaving the applied wallpaper usable',
    );
  } finally {
    window.store.path = storePath;
    window.live = live;
    window.showError = showError;
    window.preview.request = request;
    window._syncAvailability();
  }
  console.log(
    'Verified still wallpaper auto-save, exact previews, built-in/reapply deduplication, and save failures.',
  );
}

async function checkAnimatedPreview(window, artifacts) {
  const original = window.preset;
  const preset = createPreset('paper-dithering');
  preset.params.colorBack = '#80FF80';
  preset.params.colorFront = '#FF80FF';
  await window.preview.select(preset);
  await window.preview.pause(false);
  const widget = window.preview.widget;
  const paintable = new Gtk.WidgetPaintable({ widget });
  widget.queue_draw();
  await settle();
  const first = await window.preview.request('state');
  let initialPixels;
  let changed = false;
  try {
    for (let frame = 0; frame < 120; frame++) {
      const snapshot = new Gtk.Snapshot();
      paintable.snapshot(snapshot, widget.get_width(), widget.get_height());
      const node = snapshot.to_node();
      assert(node, 'Animated preview snapshot was empty');
      const texture = window.get_renderer().render_texture(node, null);
      const bytes = texture.save_to_png_bytes();
      const loader = new GdkPixbuf.PixbufLoader();
      loader.write_bytes(bytes);
      loader.close();
      const image = loader.get_pixbuf();
      const pixels = image.get_pixels();
      for (let y = 16; y < image.get_height() - 16; y += 11) {
        for (let x = 16; x < image.get_width() - 16; x += 11) {
          const offset = y * image.get_rowstride() + x * image.get_n_channels();
          if (initialPixels)
            changed ||=
              pixels[offset] !== initialPixels[offset] ||
              pixels[offset + 1] !== initialPixels[offset + 1] ||
              pixels[offset + 2] !== initialPixels[offset + 2];
          if (
            pixels[offset] < 60 ||
            pixels[offset + 1] < 60 ||
            pixels[offset + 2] < 60
          ) {
            if (artifacts)
              texture.save_to_png(`${artifacts}/preview-animation-failure.png`);
            throw new Error(
              `Cleared animated preview pixel at ${x},${y} (frame ${frame})`,
            );
          }
        }
      }
      if (!initialPixels) initialPixels = Uint8Array.from(pixels);
      if (frame === 119 && artifacts)
        texture.save_to_png(`${artifacts}/preview-animation.png`);
      await new Promise((resolve) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
          resolve();
          return GLib.SOURCE_REMOVE;
        }),
      );
    }
    const last = await window.preview.request('state');
    assert(last.frame > first.frame + 100, 'Preview clock did not advance');
    assert(changed, 'Animated preview kept displaying the same pixels');
    console.log(
      'Verified 120 animated preview frames after gallery generation.',
    );
  } finally {
    await window.preview.pause(true);
    await window.preview.select(original);
  }
}

async function checkDebugInfo(window) {
  assert(!window.store.state.debugInfo, 'Debug info must default to off');
  const settings = window.wallpaper.settings;
  const background = settings.get_string('picture-uri');
  window._save();
  let observed;
  const monitor = watchDebugInfo((enabled) => {
    observed = enabled;
  });
  try {
    window.debugAction.activate(null);
    await settle();
    assert(
      new Store().state.debugInfo && observed,
      'Debug preference did not persist or notify',
    );
    assert(
      window.debugAction.state.deepUnpack(),
      'Debug menu did not reflect enabled preference',
    );
    assert(
      !window.preview._debugEnabled && !window.preview.debug,
      'Desktop debug preference affected the preview',
    );
    window.debugAction.activate(null);
    await settle();
    assert(
      !new Store().state.debugInfo && !observed,
      'Debug toggle did not turn off and persist',
    );
    assert(
      settings.get_string('picture-uri') === background,
      'Debug toggle changed the wallpaper',
    );
  } finally {
    monitor.cancel();
    window.setDebugInfo(false);
  }
  console.log(
    'Verified saved desktop debug toggle without affecting preview or background settings.',
  );
}

async function checkSavedPresets(window, artifacts) {
  const initial = normalizePreset(window.preset.id, window.preset);
  const background = window.wallpaper.settings.get_string('picture-uri');
  await window.selectPreset('aurora');
  window.editor.numericControls.get('params.distortion').spin.set_value(0.63);
  window.editor.numericControls.get('speed').spin.set_value(-0.75);
  assert(
    window.savePresetButton.get_next_sibling() === window.exportButton,
    'Save preset button must sit immediately left of export',
  );
  window.savePresetButton.emit('clicked');
  const dialog = window.savePresetDialog;
  assert(dialog, 'Save button did not open the dialog');
  await dialog.ready;
  assert(dialog.picture.get_paintable(), 'Save dialog has no preview');
  assert(
    /^#[0-9A-F]{6}$/.test(dialog.nameEntry.text) && dialog.saveButton.sensitive,
    'Save dialog must suggest a usable random hex color name',
  );
  dialog.nameEntry.set_text('   ');
  assert(!dialog.saveButton.sensitive, 'Blank names must not be saved');
  dialog.nameEntry.set_text('Violet Bloom');
  assert(
    dialog.saveButton.sensitive,
    'A named configuration could not be saved',
  );
  if (artifacts)
    await screenshot(window, `${artifacts}/save-preset-dialog.png`);
  const expected = presetFingerprint(dialog.snapshot.preset);
  const preview = dialog.snapshot.preview;
  dialog.saveButton.emit('clicked');
  const saved = await dialog.saveTask;
  assert(saved?.name === 'Violet Bloom', 'Save dialog did not save its name');
  await settle();
  const persisted = new Store().state.savedPresets.find(
    (item) => item.id === saved.id,
  );
  assert(
    presetFingerprint(persisted.preset) === expected,
    'Saved parameters did not survive a reload',
  );
  const [, bytes] = savedPreviewFile(saved.id).load_contents(null);
  assert(
    `data:image/png;base64,${GLib.base64_encode(bytes)}` === preview,
    'Saved thumbnail differs from the dialog preview',
  );
  await window.presetGrid.ready;
  assert(
    window.presetGrid.cards.get(`saved:${saved.id}`).picture.get_paintable(),
    'Saved thumbnail was not added to the grid',
  );
  assert(
    window.presetGrid.selectedKey === `saved:${saved.id}`,
    'Saved preset is not selected',
  );
  const count = window.store.state.savedPresets.length;
  const cancelled = window.showSavePreset();
  cancelled.close();
  await cancelled.ready;
  await settle();
  assert(
    window.store.state.savedPresets.length === count,
    'Cancel saved a configuration',
  );
  let rejected = false;
  try {
    saveNamedPreset(window.store, ' violet bloom ', saved.preset, preview);
  } catch {
    rejected = true;
  }
  assert(
    rejected && window.store.state.savedPresets.length === count,
    'Duplicate names silently replaced a configuration',
  );
  const originalPath = window.store.path;
  const previewDirectory = savedPreviewFile(saved.id).get_parent();
  const countPreviews = () => {
    const entries = previewDirectory.enumerate_children(
      'standard::name',
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    let total = 0;
    while (entries.next_file(null)) total++;
    entries.close(null);
    return total;
  };
  const previewCount = countPreviews();
  try {
    window.store.path = previewDirectory.get_path();
    rejected = false;
    try {
      saveNamedPreset(window.store, 'Cannot write', saved.preset, preview);
    } catch {
      rejected = true;
    }
    assert(
      rejected &&
        window.store.state.savedPresets.length === count &&
        countPreviews() === previewCount,
      'A failed save left a phantom preset or preview',
    );
    const beforeDelete = window.store.state;
    rejected = false;
    try {
      deleteNamedPreset(window.store, saved.id);
    } catch {
      rejected = true;
    }
    assert(
      rejected &&
        window.store.state === beforeDelete &&
        savedPreviewFile(saved.id).query_exists(null) &&
        new Store().state.savedPresets.some((item) => item.id === saved.id),
      'A failed delete removed the saved configuration or its preview',
    );
  } finally {
    window.store.path = originalPath;
  }
  window.editor.numericControls.get('params.distortion').spin.set_value(0.12);
  assert(
    window.presetGrid.selectedKey === null,
    'Editing kept an inaccurate selection highlight',
  );
  assert(
    presetFingerprint(window.store.state.savedPresets[0].preset) === expected,
    'Editing mutated the named configuration',
  );
  window.presetGrid.cards.get('paper:1').card.emit('clicked');
  assert(
    window.preset.paperPreset === 1,
    'Paper thumbnail did not select its settings',
  );
  await window.selectPreset('ribbon');
  await window.selectPreset('aurora');
  assert(
    window.presetGrid.selectedKey === 'paper:1',
    'Reopening a shader did not retain its active Paper preset',
  );
  await window.selectPreset('moss');
  window.presetGrid.cards.get(`saved:${saved.id}`).card.emit('clicked');
  assert(
    presetFingerprint(window.preset) === expected,
    'Saved tile did not restore the complete configuration',
  );
  await window.selectPreset('ribbon');
  await window.selectPreset('moss');
  assert(
    window.presetGrid.selectedKey === `saved:${saved.id}` &&
      presetFingerprint(window.preset) === expected,
    'Reopening a shader did not retain its active saved preset',
  );
  await window.presetGrid.ready;
  if (artifacts) {
    const style = Adw.StyleManager.get_default();
    style.color_scheme = Adw.ColorScheme.FORCE_LIGHT;
    await screenshot(window, `${artifacts}/preset-grid-light.png`);
    style.color_scheme = Adw.ColorScheme.FORCE_DARK;
    await screenshot(window, `${artifacts}/preset-grid-dark.png`);
    style.color_scheme = Adw.ColorScheme.DEFAULT;
  }
  const other = saveNamedPreset(
    window.store,
    'Temporary preset',
    { ...saved.preset, speed: 2 },
    preview,
  );
  window.presetGrid.setPreset(window.preset, window.store.state.savedPresets);
  const otherTile = window.presetGrid.cards.get(`saved:${other.id}`);
  assert(
    otherTile.deleteButton &&
      !otherTile.card.is_ancestor(otherTile.deleteButton) &&
      !otherTile.deleteButton.is_ancestor(otherTile.card),
    'Delete must be an independent control beside preset selection',
  );
  assert(
    [...window.presetGrid.cards].every(
      ([key, tile]) => key.startsWith('saved:') || !tile.deleteButton,
    ),
    'Built-in presets must not offer deletion',
  );
  otherTile.deleteButton.emit('clicked');
  assert(
    !window.presetGrid.cards.has(`saved:${other.id}`) &&
      !new Store().state.savedPresets.some((item) => item.id === other.id) &&
      !savedPreviewFile(other.id).query_exists(null) &&
      savedPreviewFile(saved.id).query_exists(null) &&
      window.presetGrid.selectedKey === `saved:${saved.id}` &&
      presetFingerprint(window.preset) === expected,
    'Deleting another preset changed the selection or left saved files behind',
  );
  await window.selectPreset('ribbon');
  assert(
    !window.presetGrid.cards.has(`saved:${saved.id}`),
    'Saved preset appeared under a different shader',
  );
  // A missing preview can be regenerated without losing the named settings.
  savedPreviewFile(saved.id).delete(null);
  window.presetGrid._cache.clear();
  await window.selectPreset('aurora');
  await window.presetGrid.ready;
  assert(
    window.presetGrid.cards.get(`saved:${saved.id}`).picture.get_paintable(),
    'A missing saved thumbnail did not recover',
  );
  window.selectSavedPreset(saved.id);
  const current = JSON.stringify(window.preset);
  window.presetGrid.cards.get(`saved:${saved.id}`).deleteButton.emit('clicked');
  assert(
    !window.presetGrid.cards.has(`saved:${saved.id}`) &&
      window.presetGrid.selectedKey === null &&
      !new Store().state.savedPresets.some((item) => item.id === saved.id) &&
      JSON.stringify(window.preset) === current,
    'Deleting the selected preset with a missing thumbnail changed the editor or failed to persist',
  );
  assert(
    window.wallpaper.settings.get_string('picture-uri') === background,
    'Saving, browsing, or deleting configurations changed the wallpaper',
  );
  await window.selectPreset(initial.id);
  window.preset = initial;
  window._refreshSelection();
  window._changed();
  console.log(
    'Verified preset grid, named save dialog, immutable persistence, deletion, cancellation and failed writes.',
  );
}

export async function run(window) {
  assert(
    GLib.getenv('GSETTINGS_BACKEND') === 'memory',
    'Smoke tests require isolated settings',
  );
  assert(
    GLib.getenv('XDG_CONFIG_HOME')?.includes('wallshader-test.'),
    'Smoke tests require an isolated configuration',
  );
  await window.ready;
  assert(window._ready, 'Preview did not initialize');
  for (const { name, id } of PRESETS)
    assert(
      window._cards.get(id).picture.get_paintable(),
      `${name} thumbnail did not render`,
    );
  await window.preview.pause(true);
  await settle();
  assert(
    window.preview.widget.get_height() > 300,
    'Preview collapsed vertically',
  );
  assert(
    window._cards.get('aurora').picture.get_height() > 80,
    'Gallery thumbnails collapsed vertically',
  );
  const artifacts = GLib.getenv('WALLSHADER_ARTIFACTS');
  if (artifacts) GLib.mkdir_with_parents(artifacts, 0o755);
  await checkAnimatedPreview(window, artifacts);
  await checkDebugInfo(window);
  await checkSavedPresets(window, artifacts);
  for (const id of ['paper-paper-texture', 'paper-water']) {
    await window.selectPreset(id);
    window.preset.image = '';
    window._changed();
    assert(
      window.presetGrid.selectedKey === null,
      'Image edit kept a preset active',
    );
    await window.selectPreset(id);
    assert(
      window.preset.image === '',
      'Clicking the current shader reset its edits',
    );
    await window.selectPreset('aurora');
    await window.selectPreset(id);
    assert(
      window.preset.image === 'sample' &&
        window.presetGrid.selectedKey === 'default' &&
        window.presetGrid.cards.get('default').card.active &&
        presetFingerprint(window.preset) ===
          presetFingerprint(createPreset(id)),
      'Reopening unmatched settings did not select Original with the sample image',
    );
  }
  await window.selectPreset('aurora');
  if (artifacts) {
    const style = Adw.StyleManager.get_default();
    style.color_scheme = Adw.ColorScheme.FORCE_LIGHT;
    const wallpaperBefore = window.wallpaper.settings.get_string('picture-uri');
    assert(
      window.liveRendering.selected === 0,
      'Rendering must default to compatibility',
    );
    window.wallpaperMode.selected = 1;
    window.wallpaperSettings.present(window);
    await screenshot(window, `${artifacts}/wallpaper-settings.png`);
    window.liveRendering.selected = 1;
    assert(
      new Store().state.liveRendering === 'gpu',
      'GPU preference was not saved',
    );
    window.wallpaperSettings.close();
    await settle();
    window.wallpaperSettings.present(window);
    assert(
      window.liveRendering.selected === 1,
      'Dialog lost the selected rendering mode',
    );
    await screenshot(window, `${artifacts}/wallpaper-settings-gpu.png`);
    window.wallpaperTarget.selected = 1;
    await screenshot(window, `${artifacts}/wallpaper-settings-kitty.png`);
    window.wallpaperTarget.selected = 0;
    window.wallpaperSettings.close();
    window.liveRendering.selected = 0;
    assert(
      window.wallpaper.settings.get_string('picture-uri') === wallpaperBefore,
      'Changing rendering preferences applied a wallpaper',
    );
    await settle();
    await screenshot(window, `${artifacts}/window-light.png`);
    style.color_scheme = Adw.ColorScheme.FORCE_DARK;
    await screenshot(window, `${artifacts}/window-dark.png`);
    window.set_default_size(700, 800);
    await screenshot(window, `${artifacts}/window-narrow.png`);
    assert(
      window.split.collapsed,
      'Inspector did not collapse at narrow width',
    );
    window.split.show_sidebar = true;
    await screenshot(window, `${artifacts}/window-narrow-controls.png`);
    window.set_default_size(1040, 900);
    style.color_scheme = Adw.ColorScheme.DEFAULT;
    await settle();
  }
  for (const preset of PRESETS) {
    await window.selectPreset(preset.id);
    const uri = await window.preview.request('capture', {
      width: 640,
      height: 360,
    });
    if (artifacts)
      await savePng(
        Gio.File.new_for_path(`${artifacts}/${preset.id}.png`),
        uri,
      );
    try {
      checkImage(uri, 640, 360);
    } catch (error) {
      throw new Error(`${preset.name}: ${error.message}`);
    }
    console.log(`Rendered ${preset.name}: 640 × 360`);
  }
  for (const preset of SHADERS['paper-texture'].presets) {
    for (const image of ['', 'sample']) {
      await window.preview.select(
        fromPaperParams('paper-paper-texture', { ...preset.params, image }),
      );
      const uri = await window.preview.request('capture', {
        width: 640,
        height: 360,
      });
      checkImage(uri, 640, 360);
      if (artifacts)
        await savePng(
          Gio.File.new_for_path(
            `${artifacts}/paper-texture-${preset.name.toLowerCase()}-${image || 'texture'}.png`,
          ),
          uri,
        );
    }
  }
  console.log('Rendered all Paper Texture presets with and without an image.');
  await window.selectPreset('aurora');
  const frame = window.preset.frame + 8000;
  window.editor.numericControls.get('frame').spin.set_value(frame);
  assert(
    window.preset.frame === frame,
    'Frame input did not update the preview settings',
  );
  const dialog = showSharingDialog(window, {
    title: 'Wallpaper Settings',
    content: exportSettings(window.preset),
  });
  // Adw.Dialog is hosted inside its parent window; snapshot the painted root.
  if (artifacts) await screenshot(window, `${artifacts}/settings-dialog.png`);
  dialog.close();
  window.editor.numericControls.get('params.grainMixer').spin.set_value(0.55);
  assert(
    window.preset.params.grainMixer === 0.55,
    'Exact numeric input did not update shader state',
  );
  window.editor.setColorCount(10);
  assert(window.preset.colors.length === 10, 'Color count did not expand');
  const firstColor = window.preset.colors[0];
  window.editor.moveColor(0, 1);
  assert(window.preset.colors[1] === firstColor, 'Color reordering failed');
  window.editor.numericControls.get('offsetX').spin.set_value(-0.4);
  window.editor.numericControls.get('speed').spin.set_value(-2);
  assert(
    window.preset.offsetX === -0.4 && window.preset.speed === -2,
    'Position and reverse speed controls did not update',
  );
  window.selectPaperPreset(1);
  assert(
    window.preset.colors.length === 2 && window.preset.rotation === 90,
    'Paper Ink preset was not applied',
  );
  const shared = exportSettings(window.preset);
  window.selectPreset('moss');
  window.importSettings(shared);
  assert(
    window.preset.colors.length === 2 && window.preset.rotation === 90,
    'Settings import lost Paper properties',
  );
  window.selectPreset('aurora');
  window._toggleFavorite();
  assert(
    window.store.state.favorites.includes('aurora'),
    'Favorite was not added',
  );
  window.preset.scale = 1.75;
  window._changed();
  window._save();
  const persisted = new Store();
  assert(
    persisted.state.presets.aurora.scale === 1.75,
    'Edited scale did not persist',
  );
  assert(
    persisted.state.favorites.includes('aurora'),
    'Favorite did not persist',
  );
  window.resetPreset();
  assert(window.preset.scale === 1, 'Reset failed');
  await window.preview.select(window.preset);
  const still = await window.preview.request('capture', {
    width: 1920,
    height: 1080,
  });
  checkImage(still, 1920, 1080);
  window.preview.widget.set_visible(false);
  const hidden = await window.preview.request('capture', {
    width: 640,
    height: 360,
  });
  checkImage(hidden, 640, 360);
  window.preview.widget.set_visible(true);
  const uhd = await window.preview.request('capture', {
    width: 3840,
    height: 2160,
  });
  checkImage(uhd, 3840, 2160);
  const portrait = await window.preview.request('capture', {
    width: 360,
    height: 640,
  });
  checkImage(portrait, 360, 640);
  if (artifacts) {
    const uri = await importImage(
      Gio.File.new_for_path(`${artifacts}/aurora.png`),
    );
    const logoUri = await importImage(
      Gio.File.new_for_path(`${ROOT}/src/renderer/sample-logo.svg`),
    );
    for (const shader of [
      'image-dithering',
      'heatmap',
      'liquid-metal',
      'gem-smoke',
    ]) {
      const custom = fromPaperParams(presetIdForShader(shader), {
        ...SHADERS[shader].defaults,
        image: shader === 'image-dithering' ? uri : logoUri,
      });
      await window.preview.select(custom);
      const result = await window.preview.request('capture', {
        width: 640,
        height: 360,
      });
      checkImage(result, 640, 360);
      await savePng(
        Gio.File.new_for_path(`${artifacts}/custom-${shader}.png`),
        result,
      );
    }
    console.log(
      'Verified local image import and all three logo preprocessors.',
    );
  }
  const settings = window.wallpaper.settings;
  settings.set_string('picture-uri', 'file:///tmp/original-light.png');
  settings.set_string('picture-uri-dark', 'file:///tmp/original-dark.png');
  settings.set_string('picture-options', 'scaled');
  await checkAnimatedWallpaper(window);
  await checkStillWallpaperPresets(window);
  await checkKittyBackground(window);
  const file = await window.wallpaper.apply(still, 'aurora');
  assert(
    settings.get_string('picture-uri') === file.get_uri(),
    'Light wallpaper URI was not set',
  );
  assert(
    settings.get_string('picture-uri-dark') === file.get_uri(),
    'Dark wallpaper URI was not set',
  );
  await window.wallpaper.apply(still, 'aurora');
  window.wallpaper.restore();
  assert(
    settings.get_string('picture-uri') === 'file:///tmp/original-light.png',
    'Original light wallpaper was not restored',
  );
  assert(
    settings.get_string('picture-uri-dark') === 'file:///tmp/original-dark.png',
    'Original dark wallpaper was not restored',
  );
  assert(
    settings.get_string('picture-options') === 'scaled',
    'Original wallpaper layout was not restored',
  );
  assert(
    !window.wallpaper.canRestore,
    'Wallpaper backup should be cleared after restore',
  );
  console.log(
    'Verified settings persistence, PNG export, and wallpaper apply/restore.',
  );
  if (GLib.getenv('WALLSHADER_TEST_HOLD') === '1')
    await new Promise((resolve) =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
      }),
    );
}

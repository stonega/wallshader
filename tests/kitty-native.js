import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { PRESETS, createPreset } from '../src/catalog.js';
import { Store } from '../src/storage.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return new TextDecoder().decode(file.load_contents(null)[1]);
}

function write(file, source) {
  file.replace_contents(
    new TextEncoder().encode(source),
    null,
    false,
    Gio.FileCreateFlags.NONE,
    null,
  );
}

export async function checkKittyBackground(window) {
  assert(
    GLib.getenv('KITTY_CONFIG_DIRECTORY')?.includes('wallshader-test.'),
    'Kitty tests require an isolated configuration',
  );
  assert(
    !window.kitty.config.query_exists(null),
    'Startup wrote a Kitty config',
  );
  const originalLive = window.live;
  const originalError = window.showError;
  const originalCheck = window.kitty.checkAnimationSupport;
  const errors = [];
  const desktop = window.wallpaper.settings.get_string('picture-uri');
  const config = window.kitty.config;
  config.get_parent().make_directory_with_parents(null);
  const original =
    'font_size 14\ninclude theme.conf\nbackground_image /old.png\ncustom_shaders crt\n';
  write(config, original);
  // Any call into the live desktop during Kitty operations is a failure.
  window.live = {
    status: { active: true },
    stop: () => {
      throw new Error('Kitty touched the desktop');
    },
  };
  window.showError = (error) => errors.push(error.message);
  // Compilation against a real Kitty is covered by test:kitty; the native suite
  // must also run on systems without the optional Kitty installation.
  window.kitty.checkAnimationSupport = async () => {};
  try {
    // A new Kitty installation has no config yet; exercise exclusive creation.
    config.delete(null);
    await window.selectPreset('aurora');
    window.wallpaperTarget.selected = 1;
    assert(
      new Store().state.wallpaperTarget === 'kitty',
      'Kitty target did not persist',
    );
    assert(!config.query_exists(null), 'Selecting Kitty applied a background');
    assert(
      !window.desktopOptions.visible && window.kittyOptions.visible,
      'Kitty displayed desktop playback controls',
    );
    window.wallpaperMode.selected = 0;
    await window.applyWallpaper();
    assert(
      errors.length === 0 && config.query_exists(null),
      'Kitty did not create its first config',
    );
    window.restoreKittyBackground();
    assert(read(config) === '', 'Restoring a new Kitty config left overrides');
    write(config, original);
    await window.applyWallpaper();
    assert(errors.length === 0, `Kitty apply failed: ${errors}`);
    const still = read(config);
    assert(
      still.startsWith(original) &&
        still.includes('background_image_layout cscaled'),
      'Kitty config lost settings or image layout',
    );
    const path = [...still.matchAll(/^background_image (.+)$/gm)].at(-1)[1];
    assert(
      Gio.File.new_for_path(path).query_exists(null),
      'Kitty PNG was not saved',
    );
    const data = `data:image/png;base64,${GLib.base64_encode(Gio.File.new_for_path(path).load_contents(null)[1])}`;
    const pending = window.kitty.apply(data);
    write(config, `${still}# concurrent edit\n`);
    let conflict;
    try {
      await pending;
    } catch (error) {
      conflict = error;
    }
    assert(
      conflict && read(config) === `${still}# concurrent edit\n`,
      'Kitty overwrote concurrent configuration edits',
    );
    write(config, still);
    let invalid;
    try {
      await window.kitty.apply('invalid PNG');
    } catch (error) {
      invalid = error;
    }
    assert(
      invalid && read(config) === still,
      'Invalid PNG changed Kitty configuration',
    );
    assert(
      window.kittyRestoreButton.sensitive,
      'Kitty restore stayed disabled',
    );
    const seen = new Set();
    for (const { id, shader } of PRESETS) {
      if (seen.has(shader)) continue;
      seen.add(shader);
      await window.selectPreset(id);
      window.wallpaperMode.selected = 1;
      assert(
        window.applyButton.sensitive && window.wallpaperMode.sensitive,
        `Kitty disabled ${shader}`,
      );
      await window.applyWallpaper();
      assert(errors.length === 0, `Animated Kitty apply failed: ${errors}`);
      const text = read(config);
      const pipelinePath = [...text.matchAll(/^custom_shaders '(.+)'$/gm)].at(
        -1,
      )[1];
      const directory = Gio.File.new_for_path(pipelinePath).get_parent();
      assert(
        read(directory.get_child('wallshader.slang')).includes('fragment_main'),
        'Kitty shader missing',
      );
      if (
        read(directory.get_child('wallshader.pipeline')).startsWith('textures ')
      )
        assert(
          directory.get_child('wallshader-texture-0.slang').query_exists(null),
          'Kitty texture asset missing',
        );
      assert(
        directory.get_child('LICENSE').query_exists(null) &&
          directory.get_child('NOTICE').query_exists(null),
        'Paper notices missing from Kitty export',
      );
      assert(
        text.match(/# BEGIN WALLSHADER/g).length === 1,
        'Kitty reapply duplicated its config',
      );
    }
    const applied = read(config);
    const count = window.store.state.savedPresets.length;
    window.kitty.checkAnimationSupport = async () => {
      throw new Error('Kitty version unsupported');
    };
    await window.applyWallpaper();
    assert(
      errors.pop() === 'Kitty version unsupported' && read(config) === applied,
      'Unsupported Kitty version changed its config',
    );
    assert(
      window.store.state.savedPresets.length === count && !window._busy,
      'Failed Kitty apply saved a preset or stayed busy',
    );
    // Still mode remains an explicit choice and bypasses the version check.
    await window.selectPreset('paper-paper-texture');
    assert(
      window.wallpaperMode.selected === 1 && window.wallpaperMode.sensitive,
      'Image shader lost animation mode',
    );
    window.wallpaperMode.selected = 0;
    await window.applyWallpaper();
    assert(
      errors.length === 0 && !read(config).includes('.pipeline'),
      'Still mode retained Wallshader animation',
    );
    assert(
      read(config).includes('custom_shaders crt'),
      'Still mode lost the original custom shader',
    );
    window.wallpaperTarget.selected = 0;
    window.wallpaperTarget.selected = 1;
    assert(
      window.wallpaperMode.selected === 0,
      'Switching targets lost still mode',
    );
    // Request a local image without selecting it first: export must load the
    // image passed in this request, not depend on the preview's image cache.
    for (const shader of ['heatmap', 'gem-smoke', 'liquid-metal']) {
      const preset = {
        ...createPreset(`paper-${shader}`),
        image: Gio.File.new_for_path(path).get_uri(),
      };
      const exported = await window.preview.request('kitty-shader', { preset });
      assert(
        exported.textures.length === 1 &&
          exported.pipeline.includes('output_texture a'),
        `Missing processed ${shader} image`,
      );
      assert(
        exported.textures[0].includes('uint4 pixels0['),
        `Missing ${shader} texels`,
      );
    }
    write(config, `${read(config)}# User edit after apply\n`);
    window.restoreKittyBackground();
    assert(
      read(config) === `${original}# User edit after apply\n`,
      'Kitty restore lost later user edits',
    );
    assert(
      !window.kittyRestoreButton.sensitive,
      'Kitty restore stayed enabled',
    );
    assert(
      window.wallpaper.settings.get_string('picture-uri') === desktop,
      'Kitty changed the GNOME wallpaper',
    );
    // Symlinked dotfiles must stay symlinked across apply and restore.
    const target = config.get_parent().get_child('dotfiles.conf');
    config.move(target, Gio.FileCopyFlags.NONE, null, null);
    config.make_symbolic_link(target.get_path(), null);
    await window.applyWallpaper();
    window.restoreKittyBackground();
    assert(
      config
        .query_info(
          'standard::is-symlink',
          Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
          null,
        )
        .get_is_symlink(),
      'Kitty replaced the dotfile symlink',
    );
    assert(
      read(target) === `${original}# User edit after apply\n`,
      'Kitty symlink target did not restore',
    );
    // A malformed block must leave all user content intact.
    const damaged = `${original}# BEGIN WALLSHADER\n`;
    write(config, damaged);
    await window.applyWallpaper();
    assert(
      errors.pop()?.includes('incomplete or duplicated') &&
        read(config) === damaged,
      'Damaged config was overwritten',
    );
  } finally {
    window.live = originalLive;
    window.showError = originalError;
    window.kitty.checkAnimationSupport = originalCheck;
    window.wallpaperTarget.selected = 0;
    window.wallpaperMode.selected = 1;
    window._syncAvailability();
  }
  console.log(
    'Verified isolated Kitty apply, animation, restore, symlinks, failure handling and desktop independence.',
  );
}

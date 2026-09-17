import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import { createPreset } from '../wallshader@wallshader.github.io/app/src/catalog.js';
import { Store } from '../wallshader@wallshader.github.io/app/src/storage.js';

const delay = (ms) =>
  new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    }),
  );
function assert(value, message) {
  if (!value) throw new Error(message);
}
function rpc(method, parameters = null) {
  return new Promise((resolve, reject) =>
    Gio.DBus.session.call(
      'org.gnome.Shell',
      '/io/github/wallshader/Live',
      'io.github.wallshader.Live',
      method,
      parameters,
      null,
      Gio.DBusCallFlags.NONE,
      5000,
      null,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result).deepUnpack());
        } catch (error) {
          reject(error);
        }
      },
    ),
  );
}
const apply = (preset, fps = 30, rendering = 'compatibility') =>
  rpc(
    'Apply',
    new GLib.Variant('(s)', [JSON.stringify({ preset, fps, rendering })]),
  );
async function until(callback, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (callback()) return;
    await delay(200);
  }
  throw new Error(message);
}
function matchesMonitor(rect, monitor) {
  return (
    rect.x === monitor.x &&
    rect.y === monitor.y &&
    rect.width === monitor.width &&
    rect.height === monitor.height
  );
}
function checkPanel(extension) {
  for (const window of extension._windows.keys())
    assert(!window.is_fullscreen(), 'Wallpaper entered fullscreen mode');
  assert(
    Main.layoutManager.monitors.every(
      (monitor) => !global.display.get_monitor_in_fullscreen(monitor.index),
    ),
    'Wallpaper left a monitor in fullscreen mode',
  );
  assert(
    Main.layoutManager.panelBox.visible && Main.panel.mapped,
    'Wallpaper hid the top bar on an empty workspace',
  );
}
async function checkCoverage(extension) {
  await until(
    () =>
      extension._windows.size === Main.layoutManager.monitors.length &&
      [...extension._windows.keys()].every((window) => {
        const index = Number(window.get_title().split(' ').at(-1));
        const monitor = Main.layoutManager.monitors[index];
        return (
          monitor &&
          matchesMonitor(window.get_frame_rect(), monitor) &&
          matchesMonitor(window.get_buffer_rect(), monitor)
        );
      }),
    'Wallpaper frame or buffer does not cover the full monitor',
  );
}
async function screenshot(name) {
  const path = `${GLib.getenv('WALLSHADER_ARTIFACTS')}/${name}.png`;
  const stream = Gio.File.new_for_path(path).replace(
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  );
  try {
    await new Shell.Screenshot().screenshot(false, stream);
  } finally {
    stream.close(null);
  }
}

function checkOverview(extension) {
  const entries = [...extension._overview._clones];
  for (const monitor of Main.layoutManager.monitors) {
    assert(
      entries.some(
        ([actor, { clone }]) =>
          actor instanceof Workspace &&
          actor.monitorIndex === monitor.index &&
          clone.mapped &&
          clone.width > 0 &&
          clone.height > 0,
      ),
      `Overview has no shader for monitor ${monitor.index}`,
    );
  }
  assert(
    entries.some(([actor]) => actor instanceof WorkspaceThumbnail),
    'Workspace thumbnails have no shader',
  );
  for (const [actor, { clone, source }] of entries) {
    assert(clone.get_source() === source, 'Overview lost its live source');
    assert(
      extension._windows.has(source.meta_window),
      'Overview cloned an unrelated window',
    );
    if (clone.mapped)
      assert(
        clone.width > 0 && clone.height > 0,
        'Visible overview shader has no allocation',
      );
    if (actor instanceof WorkspaceThumbnail)
      assert(
        actor._contents.get_first_child() === clone,
        'Wallpaper covers thumbnail windows',
      );
  }
}

function startResizeClient(path, count = 1) {
  const launcher = new Gio.SubprocessLauncher({});
  launcher.setenv(
    'WAYLAND_DISPLAY',
    GLib.getenv('WALLSHADER_TEST_DISPLAY'),
    true,
  );
  launcher.setenv('GDK_BACKEND', 'wayland', true);
  launcher.unsetenv('DISPLAY');
  const process = launcher.spawnv([
    'gjs',
    '-m',
    `${path}/resize-client.js`,
    String(count),
  ]);
  launcher.close();
  return process;
}

async function stopClient(process) {
  process.send_signal(15);
  await new Promise((resolve) =>
    process.wait_async(null, (child, result) => {
      child.wait_finish(result);
      resolve();
    }),
  );
}

async function checkWorkspacePlayback(extension, path, inspect) {
  const manager = global.workspace_manager;
  const covered = manager.get_active_workspace();
  const empty = manager.get_workspace_by_index(1);
  const monitors = Main.layoutManager.monitors;
  const settings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
  const primaryOnly = settings.get_boolean('workspaces-only-on-primary');
  // Both displays must become visible so both renderers receive repaint callbacks.
  settings.set_boolean('workspaces-only-on-primary', false);
  const client = startResizeClient(path, monitors.length);
  const process = extension._process;
  try {
    let windows;
    await until(() => {
      windows = global
        .get_window_actors()
        .filter(
          (actor) =>
            actor.meta_window.get_pid() === Number(client.get_identifier()),
        )
        .map((actor) => actor.meta_window);
      return (
        windows.length === monitors.length &&
        windows.every((window) => window.get_compositor_private()?.mapped)
      );
    }, 'Workspace test windows did not map');
    for (const [index, window] of windows.entries()) {
      window.move_to_monitor(monitors[index].index);
      window.maximize();
    }
    await rpc('SetPaused', new GLib.Variant('(b)', [false]));
    await until(
      () => extension._desktopCovered(),
      'Maximized test windows did not cover the desktop',
    );
    // Cross a coverage poll while maximized to catch delayed automatic pauses.
    await delay(2500);
    assert(
      !JSON.parse(extension.GetStatus()).compositing,
      'Covered desktop retained its compositor inhibitor',
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await inspect();
      assert(
        !before.paused && !JSON.parse(extension.GetStatus()).paused,
        'Maximized applications paused wallpaper playback',
      );
      empty.activate(global.get_current_time());
      // Assert before yielding: the periodic timer cannot mask a missing signal.
      assert(
        !JSON.parse(extension.GetStatus()).paused,
        'Workspace switch paused wallpaper playback',
      );
      assert(
        JSON.parse(extension.GetStatus()).compositing,
        'Visible wallpaper can bypass Shell compositing',
      );
      await delay(500);
      const playing = await inspect();
      checkPanel(extension);
      assert(
        !playing.paused &&
          playing.frames.every((frame, index) => frame > before.frames[index]),
        `Renderer did not animate after switching to the empty workspace: paused=${playing.paused}, frames=${before.frames} -> ${playing.frames}`,
      );
      covered.activate(global.get_current_time());
      assert(
        !JSON.parse(extension.GetStatus()).paused,
        'Returning to the covered workspace paused playback',
      );
      assert(
        !JSON.parse(extension.GetStatus()).compositing,
        'Returning to covered desktop retained its compositor inhibitor',
      );
      await delay(500);
    }
    await rpc('SetPaused', new GLib.Variant('(b)', [true]));
    const held = await inspect();
    empty.activate(global.get_current_time());
    assert(
      JSON.parse(extension.GetStatus()).reason === 'Paused',
      'Workspace switch ignored manual pause',
    );
    assert(
      JSON.parse(extension.GetStatus()).compositing,
      'Manually paused wallpaper can bypass Shell compositing',
    );
    await delay(500);
    const still = await inspect();
    checkPanel(extension);
    assert(
      still.paused &&
        still.frames.every((frame, index) => frame === held.frames[index]),
      'Workspace switch advanced a manually paused shader',
    );
    assert(
      extension._process === process,
      'Workspace switch restarted renderer',
    );
    console.log(
      'Verified continuous playback across maximized applications and workspace switches, with manual pause preserved.',
    );
  } finally {
    covered.activate(global.get_current_time());
    await stopClient(client);
    settings.set_boolean('workspaces-only-on-primary', primaryOnly);
  }
}

async function checkLockPlayback(extension, inspect) {
  const process = extension._process;
  const windows = [...extension._windows.keys()];
  for (const manualPaused of [false, true]) {
    await rpc('SetPaused', new GLib.Variant('(b)', [manualPaused]));
    const before = await inspect();
    // Exercise the real extension-manager transition on the private Shell.
    // This avoids authenticating or locking the user's desktop.
    Main.sessionMode.pushMode('unlock-dialog');
    try {
      await delay(manualPaused ? 600 : 2500);
      assert(Main.sessionMode.isLocked, 'Test did not enter the lock mode');
      assert(
        extension._enabled &&
          extension._ready &&
          extension._process === process,
        'Lock mode stopped or restarted the wallpaper renderer',
      );
      assert(
        JSON.parse(extension.GetStatus()).paused === manualPaused,
        'Lock mode changed the requested playback state',
      );
      const locked = await inspect();
      assert(locked.paused === manualPaused, 'Lock mode paused the renderer');
    } finally {
      Main.sessionMode.popMode('unlock-dialog');
    }
    const after = await inspect();
    assert(
      extension._process === process &&
        windows.every((window) => extension._windows.has(window)),
      'Unlocking recreated the wallpaper renderer or windows',
    );
    assert(
      after.paused === manualPaused &&
        after.frames.every((frame, index) =>
          manualPaused
            ? frame === before.frames[index]
            : frame > before.frames[index],
        ),
      'Lock/unlock failed to preserve animation and manual pause',
    );
    checkPanel(extension);
  }
  console.log(
    'Verified renderer continuity and manual pause across lock modes.',
  );
}

async function checkResize(extension, path) {
  // Both colors are bright, so black/cleared triangles cannot be shader content.
  const preset = createPreset('paper-dithering');
  preset.params.colorBack = '#80FF80';
  preset.params.colorFront = '#FF80FF';
  await apply(preset, 60);
  await delay(1000);
  const process = startResizeClient(path);
  let resize = 0;
  try {
    let window;
    await until(() => {
      window = global
        .get_window_actors()
        .find(
          (actor) =>
            actor.meta_window.get_pid() === Number(process.get_identifier()),
        )?.meta_window;
      return Boolean(window);
    }, 'Resize test window did not appear');
    assert(
      !extension._client.owns_window(window),
      'Resize client is owned by the wallpaper',
    );
    const monitor = Main.layoutManager.primaryMonitor;
    window.move_to_monitor(monitor.index);
    await until(
      () => window.get_compositor_private()?.mapped,
      'Fullscreen test window did not map',
    );
    window.make_fullscreen();
    await until(
      () => window.is_fullscreen() && !Main.layoutManager.panelBox.visible,
      'A regular fullscreen app no longer hides the top bar',
    );
    const workspace = global.workspace_manager.get_active_workspace();
    global.workspace_manager
      .get_workspace_by_index(1)
      .activate(global.get_current_time());
    await delay(800);
    checkPanel(extension);
    workspace.activate(global.get_current_time());
    await until(
      () => window.is_fullscreen() && !Main.layoutManager.panelBox.visible,
      'Returning to a fullscreen app did not hide the top bar',
    );
    window.unmake_fullscreen();
    await until(
      () => !window.is_fullscreen() && Main.panel.mapped,
      'The top bar did not return after leaving fullscreen',
    );
    checkPanel(extension);
    let step = 0;
    let moving = false;
    resize = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      const fraction = (Math.sin(step++ / 8) + 1) / 2;
      if (moving) {
        window.move_frame(
          false,
          monitor.x + monitor.width - 680 - Math.round(560 * fraction),
          monitor.y + monitor.height - 520 - Math.round(520 * (1 - fraction)),
        );
        return GLib.SOURCE_CONTINUE;
      }
      const width = 400 + Math.round(800 * fraction);
      const height = 300 + Math.round(700 * fraction);
      window.move_resize_frame(
        false,
        monitor.x + monitor.width - width - 40,
        monitor.y + monitor.height - height - 40,
        width,
        height,
      );
      return GLib.SOURCE_CONTINUE;
    });
    await delay(800);
    const sizes = new Set();
    const positions = new Set();
    let heldPixels;
    for (let frame = 0; frame < 48; frame++) {
      if (frame === 18 || frame === 42) {
        moving = true;
        window.move_resize_frame(
          false,
          monitor.x + monitor.width - 680,
          monitor.y + monitor.height - 520,
          640,
          480,
        );
      }
      if (frame === 36) {
        moving = false;
        await rpc('SetPaused', new GLib.Variant('(b)', [true]));
        await delay(300);
      }
      const stream = Gio.MemoryOutputStream.new_resizable();
      await new Shell.Screenshot().screenshot(false, stream);
      stream.close(null);
      const loader = new GdkPixbuf.PixbufLoader();
      loader.write_bytes(stream.steal_as_bytes());
      loader.close();
      const image = loader.get_pixbuf();
      const pixels = image.get_pixels();
      const rect = window.get_frame_rect();
      sizes.add(`${rect.width}x${rect.height}`);
      if (moving) positions.add(`${rect.x},${rect.y}`);
      // Exclude the window's entire swept area, including shadows. A screenshot
      // may contain an older buffer than get_frame_rect() during rapid resizing.
      for (
        let y = monitor.y + 100;
        y < monitor.y + monitor.height - 40;
        y += 19
      ) {
        for (
          let x = monitor.x + 40;
          x < monitor.x + monitor.width - 40;
          x += 19
        ) {
          if (
            x >= monitor.x + monitor.width - 1320 &&
            y >= monitor.y + monitor.height - 1120
          )
            continue;
          const offset = y * image.get_rowstride() + x * image.get_n_channels();
          if (
            pixels[offset] < 60 ||
            pixels[offset + 1] < 60 ||
            pixels[offset + 2] < 60
          ) {
            image.savev(
              `${GLib.getenv('WALLSHADER_ARTIFACTS')}/live-resize-failure.png`,
              'png',
              [],
              [],
            );
            throw new Error(
              `Cleared wallpaper pixel during ${moving ? 'move' : 'resize'} at ${x},${y} (frame ${frame})`,
            );
          }
          if (heldPixels) {
            assert(
              pixels[offset] === heldPixels[offset] &&
                pixels[offset + 1] === heldPixels[offset + 1] &&
                pixels[offset + 2] === heldPixels[offset + 2],
              `Paused wallpaper changed during ${moving ? 'move' : 'resize'} at ${x},${y}`,
            );
          }
        }
      }
      if (frame === 36) {
        heldPixels = pixels;
      }
      if (frame === 47)
        image.savev(
          `${GLib.getenv('WALLSHADER_ARTIFACTS')}/live-resize.png`,
          'png',
          [],
          [],
        );
      await delay(30);
    }
    assert(
      step > 24 && sizes.size > 4 && positions.size > 4,
      'Window stress did not both resize and move the client',
    );
    await checkCoverage(extension);
    console.log(
      'Verified 48 animated/paused composited frames while resizing and moving another Wayland window.',
    );
  } finally {
    if (resize) GLib.source_remove(resize);
    await stopClient(process);
  }
}

export default class ShellTest extends Extension {
  enable() {
    this._run().then(
      () => this._finish('PASS'),
      (error) => this._finish(`FAIL: ${error.message}\n${error.stack}`),
    );
  }
  _finish(result) {
    console.log(`Wallshader Shell test: ${result}`);
    Gio.File.new_for_path(
      GLib.getenv('WALLSHADER_SHELL_TEST_RESULT'),
    ).replace_contents(
      new TextEncoder().encode(result),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    );
  }
  async _run() {
    assert(
      GLib.get_user_config_dir().includes('wallshader-shell-test.'),
      'Shell tests require isolated settings',
    );
    new Gio.Settings({ schema_id: 'org.gnome.mutter' }).set_boolean(
      'dynamic-workspaces',
      false,
    );
    // Session-mode extensions alone are removed from the enabled list on lock.
    global.settings.set_strv('enabled-extensions', [
      'wallshader@wallshader.github.io',
      'wallshader-test@local',
    ]);
    const workspaceSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.wm.preferences',
    });
    workspaceSettings.set_int('num-workspaces', 3);
    await delay(2000);
    Main.overview.hide();
    const extension = Main.extensionManager.lookup(
      'wallshader@wallshader.github.io',
    ).stateObj;
    assert(extension, 'Live wallpaper extension did not load');
    assert(
      !JSON.parse(extension.GetStatus()).active,
      'Extension started a wallpaper without an apply action',
    );
    const before = global.settings.get_strv('enabled-extensions');
    const preset = createPreset('aurora');
    preset.speed = 0.6;
    await apply(preset);
    await delay(3000);
    console.log(
      `Renderer actions: ${extension._actions.list_actions()} ready=${extension._actions.get_action_state('ready')?.print(true)}`,
    );
    console.log(
      `Wallpaper startup: ${extension.GetStatus()} ${JSON.stringify(global.get_window_actors().map((actor) => ({ title: actor.meta_window.get_title(), type: actor.meta_window.get_window_type(), owned: extension._client?.owns_window(actor.meta_window) })))}`,
    );
    await until(
      () =>
        JSON.parse(extension.GetStatus()).ready &&
        extension._windows.size === Main.layoutManager.monitors.length,
      `Renderer did not become ready`,
    );
    checkPanel(extension);
    global.workspace_manager
      .get_workspace_by_index(1)
      .activate(global.get_current_time());
    await delay(800);
    checkPanel(extension);
    global.workspace_manager
      .get_workspace_by_index(0)
      .activate(global.get_current_time());
    await delay(800);
    // A late fullscreen state must not turn a desktop into a fullscreen app.
    for (const window of extension._windows.keys()) window.make_fullscreen();
    await delay(800);
    checkPanel(extension);
    await screenshot('live-desktop-first');
    for (const window of extension._windows.keys()) {
      assert(
        window.get_window_type() === Meta.WindowType.DESKTOP,
        'Wallpaper is not a desktop window',
      );
      assert(window.is_skip_taskbar(), 'Wallpaper appears in the taskbar');
      assert(
        window.is_on_all_workspaces(),
        'Wallpaper is not on every workspace',
      );
      const monitor = Main.layoutManager.monitors[window.get_monitor()];
      const rect = window.get_frame_rect();
      assert(
        rect.x === monitor.x &&
          rect.y === monitor.y &&
          rect.width === monitor.width &&
          rect.height === monitor.height,
        `Wallpaper size differs from its monitor: ${[rect.x, rect.y, rect.width, rect.height]} expected ${[monitor.x, monitor.y, monitor.width, monitor.height]}`,
      );
      const buffer = window.get_buffer_rect();
      assert(
        buffer.x === monitor.x &&
          buffer.y === monitor.y &&
          buffer.width === monitor.width &&
          buffer.height === monitor.height,
        `Wallpaper buffer differs from its monitor: ${[buffer.x, buffer.y, buffer.width, buffer.height]} expected ${[monitor.x, monitor.y, monitor.width, monitor.height]}`,
      );
    }
    await delay(1500);
    // Reproduce a late work-area-sized configure, after initial placement.
    // The missing panel-height strip must not persist at the bottom.
    for (const window of extension._windows.keys()) {
      const monitor = Main.layoutManager.monitors[window.get_monitor()];
      window.move_resize_frame(
        false,
        monitor.x,
        monitor.y,
        monitor.width,
        monitor.height - Main.panel.height,
      );
    }
    await delay(800);
    await checkCoverage(extension);
    checkPanel(extension);
    // A later move must also keep the wallpaper anchored to its own monitor.
    for (const window of extension._windows.keys()) {
      const monitor = Main.layoutManager.monitors[window.get_monitor()];
      window.move_frame(false, monitor.x + 8, monitor.y + Main.panel.height);
    }
    await delay(800);
    await checkCoverage(extension);
    checkPanel(extension);
    await screenshot('live-desktop-first');
    async function inspect() {
      extension._actions.activate_action('inspect', null);
      await delay(600);
      return JSON.parse(
        extension._actions.get_action_state('diagnostics').deepUnpack(),
      );
    }
    const first = await inspect();
    assert(
      first.rendering === 'compatibility' && first.skiaCpuRendering === '1',
      'Default desktop rendering did not use compatibility mode',
    );
    assert(
      first.debugInfo.every((enabled) => !enabled),
      'Desktop debug info must default to off',
    );
    const debugStore = new Store();
    debugStore.state.debugInfo = true;
    debugStore.save();
    await delay(1600);
    const debug = await inspect();
    assert(
      debug.debugInfo.every(Boolean),
      'Desktop did not pick up the saved debug toggle',
    );
    assert(
      debug.debugStats.every((info) => info?.fps > 0 && info.canvas[0] > 0),
      'Desktop debug statistics did not update on all monitors',
    );
    await screenshot('live-desktop-debug');
    debugStore.state.debugInfo = false;
    debugStore.save();
    await delay(300);
    assert(
      (await inspect()).debugInfo.every((enabled) => !enabled),
      'Desktop debug overlay did not hide',
    );
    const backend = GLib.getenv('GSK_RENDERER');
    if (backend === 'gl' || backend === 'vulkan') {
      const expected = backend === 'gl' ? 'GskGLRenderer' : 'GskVulkanRenderer';
      assert(
        first.renderers.every((renderer) => renderer === expected),
        `Desktop renderer backend differs: ${first.renderers}`,
      );
    }
    await delay(1200);
    const next = await inspect();
    assert(
      next.frames.every((frame, index) => frame > first.frames[index] + 100),
      'Desktop shader did not animate',
    );
    await screenshot('live-desktop-second');
    await checkResize(extension, this.path);
    await checkWorkspacePlayback(extension, this.path, inspect);
    await checkLockPlayback(extension, inspect);
    await apply(preset);
    await delay(500);
    await rpc('SetPaused', new GLib.Variant('(b)', [true]));
    await delay(500);
    const paused = await inspect();
    await delay(800);
    const held = await inspect();
    assert(
      held.frames.every((frame, index) => frame === paused.frames[index]),
      'Pause did not hold the frame',
    );
    await rpc('SetPaused', new GLib.Variant('(b)', [false]));
    Main.overview.show();
    await delay(1000);
    assert(
      !JSON.parse(extension.GetStatus()).paused,
      'Overview paused the visible wallpaper',
    );
    checkOverview(extension);
    workspaceSettings.set_int('num-workspaces', 4);
    await delay(800);
    const primaryPreviews = [...extension._overview._clones.keys()].filter(
      (actor) =>
        actor instanceof Workspace &&
        actor.monitorIndex === Main.layoutManager.primaryIndex,
    );
    assert(
      primaryPreviews.length === 4,
      'New workspace did not receive the live background',
    );
    const overviewFirst = await inspect();
    await screenshot('live-overview-first');
    await delay(1000);
    const overviewNext = await inspect();
    assert(
      overviewNext.frames.every(
        (frame, index) => frame > overviewFirst.frames[index] + 100,
      ),
      'Overview shader did not animate',
    );
    await screenshot('live-overview-second');
    await rpc('SetPaused', new GLib.Variant('(b)', [true]));
    const overviewPaused = await inspect();
    await delay(600);
    const overviewHeld = await inspect();
    assert(
      overviewHeld.frames.every(
        (frame, index) => frame === overviewPaused.frames[index],
      ),
      'Overview ignored manual pause',
    );
    await rpc('SetPaused', new GLib.Variant('(b)', [false]));
    Main.overview.hide();
    await delay(800);
    assert(
      extension._overview._clones.size === 0 &&
        extension._overview._watched.size === 0,
      'Overview left actors or signals after closing',
    );
    await checkCoverage(extension);
    checkPanel(extension);
    const replacement = createPreset('ribbon');
    for (const rendering of ['gpu', 'compatibility']) {
      const previousProcess = extension._process;
      await apply(preset, 30, rendering);
      await until(
        () => extension._process !== previousProcess && extension._ready,
        `Switching to ${rendering} did not restart the renderer`,
      );
      await checkCoverage(extension);
      const started = await inspect();
      assert(
        started.rendering === rendering &&
          started.skiaCpuRendering === (rendering === 'gpu' ? '0' : '1') &&
          JSON.parse(extension.GetStatus()).rendering === rendering,
        `The new renderer did not receive ${rendering} settings`,
      );
      const runningProcess = extension._process;
      await apply(preset, 60, rendering);
      const updated = await inspect();
      const playing = await inspect();
      assert(
        extension._process === runningProcess &&
          updated.fps === 60 &&
          playing.frames.every((frame, index) => frame > updated.frames[index]),
        'Reapplying the same rendering mode restarted or froze the renderer',
      );
      await rpc('SetPaused', new GLib.Variant('(b)', [true]));
      const pausedMode = await inspect();
      const heldMode = await inspect();
      assert(
        heldMode.paused &&
          heldMode.frames.every(
            (frame, index) => frame === pausedMode.frames[index],
          ),
        `${rendering} mode ignored manual pause`,
      );
    }
    console.log(
      'Verified GPU/compatibility restarts, same-mode reload, and pause.',
    );
    replacement.speed = -0.5;
    await apply(replacement, 60);
    await delay(1200);
    const reverse = await inspect();
    await delay(800);
    const reversed = await inspect();
    assert(
      reversed.preset === 'ribbon' && reversed.fps === 60,
      'Live shader update failed',
    );
    assert(
      reversed.frames.every((frame, index) => frame < reverse.frames[index]),
      'Reverse animation failed',
    );
    const oldProcess = extension._process;
    Main.overview.show();
    await delay(800);
    checkOverview(extension);
    Main.layoutManager.emit('monitors-changed');
    await until(
      () =>
        extension._process !== oldProcess &&
        JSON.parse(extension.GetStatus()).ready,
      'Monitor layout restart failed',
    );
    await checkCoverage(extension);
    // GNOME closes Activities on a monitor layout change.
    Main.overview.show();
    await delay(800);
    checkOverview(extension);
    const process = extension._process;
    await rpc('Stop');
    assert(
      !JSON.parse(extension.GetStatus()).compositing,
      'Stopping retained the wallpaper compositor inhibitor',
    );
    assert(
      extension._overview._clones.size === 0 &&
        extension._overview._watched.size === 0,
      'Stop left overview actors or signals',
    );
    await until(
      () =>
        !global
          .get_window_actors()
          .some((actor) =>
            actor.meta_window.get_title()?.startsWith('Wallshader Desktop '),
          ),
      'Stopping left desktop windows behind',
    );
    assert(
      !JSON.parse(extension.GetStatus()).active,
      'Stop left renderer active',
    );
    assert(
      JSON.stringify(before) ===
        JSON.stringify(global.settings.get_strv('enabled-extensions')),
      'Live operation changed other extensions',
    );
    await screenshot('live-desktop-stopped');
    // Restart, then disable: the renderer must exit while the saved choice remains.
    await apply(preset);
    await until(
      () => JSON.parse(extension.GetStatus()).ready,
      'Restart failed',
    );
    await delay(800);
    checkOverview(extension);
    extension.disable();
    assert(
      !JSON.parse(extension.GetStatus()).compositing,
      'Disabling retained the wallpaper compositor inhibitor',
    );
    assert(
      extension._overview._clones.size === 0 &&
        extension._overview._watched.size === 0,
      'Disable left overview actors or signals',
    );
    await until(
      () =>
        !global
          .get_window_actors()
          .some((actor) =>
            actor.meta_window.get_title()?.startsWith('Wallshader Desktop '),
          ),
      'Disable left renderer windows behind',
    );
    assert(
      process !== extension._process,
      'Renderer lifecycle was not cleared',
    );
  }
  disable() {}
}

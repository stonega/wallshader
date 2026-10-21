import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
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

function checkDesktopMenus(enabled = true, visible = true) {
  const menus = Main.layoutManager._bgManagers.map(
    ({ backgroundActor }) => backgroundActor._backgroundMenu,
  );
  assert(menus.length > 0, 'Desktop has no background menus');
  for (const menu of menus) {
    const items = menu._getMenuItems();
    const matches = items.filter(
      (item) => item.label?.text === 'Open Wallshader',
    );
    assert(
      matches.length === (enabled ? 1 : 0),
      'Desktop menu has a missing, duplicate, or stale Wallshader action',
    );
    if (!enabled) continue;
    const background = menu._settingsActions['gnome-background-panel.desktop'];
    assert(
      items.indexOf(matches[0]) === items.indexOf(background) + 1,
      'Open Wallshader must follow Change Background',
    );
    assert(
      matches[0].visible === visible,
      'Desktop menu shortcut ignored its visibility preference',
    );
  }
  return menus[0];
}

async function checkDesktopMenuPreference(extension) {
  const store = new Store();
  for (const show of [false, true, false]) {
    store.state.showDesktopMenu = show;
    store.save();
    await until(
      () => extension._desktopMenu._showMenu === show,
      'Desktop menu did not update after saving Preferences',
    );
    checkDesktopMenus(true, show);
  }
  await Main.layoutManager._updateBackgrounds();
  await until(
    () =>
      Main.layoutManager._bgManagers.every(({ backgroundActor }) =>
        extension._desktopMenu._items.has(backgroundActor._backgroundMenu),
      ),
    'Recreated desktop menus did not receive their shortcut',
  );
  checkDesktopMenus(true, false);
  const monitor = extension._desktopMenu._monitor;
  extension._desktopMenu.destroy();
  assert(
    monitor.is_cancelled(),
    'Desktop menu left its preference monitor running',
  );
  const { DesktopMenu } = await import(
    '../wallshader@wallshader.github.io/desktop-menu.js'
  );
  extension._desktopMenu = new DesktopMenu(extension.path);
  checkDesktopMenus(true, false);
  delete store.state.showDesktopMenu;
  store.save();
  await until(
    () => extension._desktopMenu._showMenu,
    'Missing desktop menu preference did not restore the default',
  );
  checkDesktopMenus();
  console.log(
    'Verified immediate desktop menu visibility, saved opt-out, background rebuild and monitor cleanup.',
  );
}

async function checkDesktopLaunch() {
  const menu = checkDesktopMenus();
  Main.layoutManager.setDummyCursorGeometry(400, 300, 0, 0);
  menu.open();
  await delay(300);
  await screenshot('desktop-menu');
  const item = menu
    ._getMenuItems()
    .find((entry) => entry.label?.text === 'Open Wallshader');
  const keyboard = global.stage.context
    .get_backend()
    .get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  const activate = async () => {
    menu.open();
    item.grab_key_focus();
    keyboard.notify_keyval(
      GLib.get_monotonic_time(),
      Clutter.KEY_Return,
      Clutter.KeyState.PRESSED,
    );
    keyboard.notify_keyval(
      GLib.get_monotonic_time(),
      Clutter.KEY_Return,
      Clutter.KeyState.RELEASED,
    );
    await delay(100);
  };
  const windows = () =>
    global
      .get_window_actors()
      .filter(
        (actor) =>
          actor.meta_window.get_gtk_application_id() ===
          'io.github.wallshader.Wallshader',
      );
  await activate();
  await until(
    () => windows().length === 1,
    'Desktop menu did not open Wallshader',
  );
  const window = windows()[0].meta_window;
  const app = Shell.AppSystem.get_default().lookup_app(
    'io.github.wallshader.Wallshader.desktop',
  );
  await until(
    () =>
      app.get_state() === Shell.AppState.RUNNING &&
      app.get_windows().includes(window),
    'Shell did not associate the editor with its desktop application',
  );
  await delay(500);
  window.minimize();
  await delay(300);
  await activate();
  await until(
    () => !window.minimized,
    'Desktop menu did not present Wallshader',
  );
  assert(windows().length === 1, 'Desktop menu opened a duplicate app window');
  const actions = Gio.DBusActionGroup.get(
    Gio.DBus.session,
    'io.github.wallshader.Wallshader',
    '/io/github/wallshader/Wallshader',
  );
  await until(
    () => actions.has_action('quit'),
    'Editor quit action is unavailable',
  );
  actions.activate_action('quit', null);
  await until(
    () => windows().length === 0,
    'Desktop menu test left the editor open',
  );
  console.log(
    'Verified desktop menu order, app launch, and existing-window activation.',
  );
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
    if (await callback()) return;
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
  for (const monitor of Main.layoutManager.monitors) {
    const background =
      Main.layoutManager._bgManagers[monitor.index].backgroundActor;
    const entry = extension._desktop._backgrounds.get(background);
    assert(
      entry && entry.live.source.opacity === 0,
      `Desktop still presents the renderer window: monitor=${monitor.index}, background=${Boolean(entry)}, opacity=${entry?.live.source.opacity}`,
    );
    assert(
      background.get_effect('wallshader-background') === entry.live.effect,
      'Desktop lost its live background actor',
    );
  }
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
  const entries = [...extension._overview._backgrounds];
  const visit = (actor) => {
    if (actor instanceof Workspace) {
      for (const background of actor._background._backgroundGroup.get_children())
        if (background instanceof Meta.BackgroundActor && background.mapped)
          assert(
            extension._overview._backgrounds.has(background),
            `Visible workspace background has no live texture on monitor ${actor.monitorIndex}`,
          );
    } else if (actor instanceof WorkspaceThumbnail) {
      if (actor.mapped)
        assert(
          extension._overview._backgrounds.has(actor),
          `Visible thumbnail has no live texture on monitor ${actor.monitorIndex}`,
        );
    } else {
      for (const child of actor.get_children()) visit(child);
    }
  };
  const controls = Main.overview._overview.controls;
  visit(controls._workspacesDisplay);
  visit(controls._thumbnailsBox);
  for (const view of controls._workspacesDisplay._workspacesViews) visit(view);
  for (const background of Main.layoutManager._backgroundGroup.get_children())
    if (background instanceof Meta.BackgroundActor && background.mapped)
      assert(
        extension._desktop._backgrounds.has(background),
        'Visible desktop background has no live texture',
      );
  for (const monitor of Main.layoutManager.monitors) {
    assert(
      entries.some(
        ([_actor, { live, thumbnail }]) =>
          !thumbnail &&
          live.actor.content.monitor === monitor.index &&
          live.actor.mapped &&
          live.actor.width > 0 &&
          live.actor.height > 0,
      ),
      `Overview has no shader for monitor ${monitor.index}`,
    );
  }
  assert(
    entries.some(([actor]) => actor instanceof WorkspaceThumbnail),
    'Workspace thumbnails have no shader',
  );
  for (const [actor, { live, source, thumbnail }] of entries) {
    assert(
      live.actor instanceof Meta.BackgroundActor,
      'Wallpaper bypasses the background actor',
    );
    assert(
      live.actor.content instanceof Meta.BackgroundContent,
      'Wallpaper replaced the native background content',
    );
    assert(
      live.driver.get_source() === source && live.driver.has_effects(),
      'Wallpaper lost its frame source',
    );
    assert(
      live.actor.get_effect('wallshader-background') === live.effect,
      'Background lost its live texture',
    );
    assert(
      live.driver.get_parent() === live.actor.get_parent() &&
        live.driver.get_next_sibling() === live.actor,
      'Live capture must paint immediately before its background',
    );
    assert(
      extension._windows.has(source.meta_window),
      'Overview sampled an unrelated window',
    );
    if (live.actor.mapped)
      assert(
        live.actor.width > 0 && live.actor.height > 0,
        'Visible overview shader has no allocation',
      );
    if (thumbnail)
      assert(
        actor._contents
          .get_children()
          .filter((child) => child !== live.driver)[0] === live.actor,
        'Wallpaper covers thumbnail windows',
      );
  }
}

async function capturePixels() {
  const stream = Gio.MemoryOutputStream.new_resizable();
  await new Shell.Screenshot().screenshot(false, stream);
  stream.close(null);
  const loader = new GdkPixbuf.PixbufLoader();
  loader.write_bytes(stream.steal_as_bytes());
  loader.close();
  return loader.get_pixbuf();
}

async function checkOverviewTransition(extension) {
  // A red saved still and a green live surface make a one-frame fallback visible.
  const settings = new Gio.Settings({
    schema_id: 'org.gnome.desktop.background',
  });
  settings.set_string('picture-options', 'none');
  settings.set_string('primary-color', '#FF0000');
  const preset = createPreset('paper-dithering');
  preset.params.colorBack = '#00FF00';
  preset.params.colorFront = '#00FF00';
  await apply(preset, 60);
  const scan = (image) => {
    const pixels = image.get_pixels();
    const stride = image.rowstride;
    const channels = image.n_channels;
    return Main.layoutManager.monitors.map((monitor) => {
      let red = 0;
      let green = 0;
      for (
        let y = monitor.y + 40;
        y < monitor.y + monitor.height - 20;
        y += 19
      ) {
        for (
          let x = monitor.x + 20;
          x < monitor.x + monitor.width - 20;
          x += 19
        ) {
          const pixelX = Math.floor((x * image.width) / global.stage.width);
          const pixelY = Math.floor((y * image.height) / global.stage.height);
          const offset = pixelY * stride + pixelX * channels;
          red +=
            pixels[offset] > 80 &&
            pixels[offset + 1] < 20 &&
            pixels[offset + 2] < 20;
          green +=
            pixels[offset + 1] > 80 &&
            pixels[offset] < 20 &&
            pixels[offset + 2] < 20;
        }
      }
      return { index: monitor.index, red, green };
    });
  };
  // Wait for the applied surface, rather than testing the previous shader's buffer.
  await until(
    async () => scan(await capturePixels()).every(({ green }) => green > 20),
    'Green live surface did not reach every monitor',
  );
  const process = extension._process;
  for (const [entry, paused] of [
    ['show', false],
    ['show', true],
    ['redraw', false],
    ['redraw', true],
    ['gesture', false],
    ['gesture', true],
  ]) {
    await rpc('SetPaused', new GLib.Variant('(b)', [paused]));
    // Input and Shell callbacks can enter during a compositor frame, before an
    // idle callback gets a chance to attach newly created thumbnail clones.
    let paintError;
    let paints = 0;
    const paintId = global.stage.connect('before-paint', () => {
      paints++;
      try {
        checkOverview(extension);
      } catch (error) {
        paintError ??= error;
      }
    });
    const controls = Main.overview._overview.controls;
    if (entry === 'redraw') {
      await new Promise((resolve) =>
        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
          Main.overview.show();
          resolve();
          return GLib.SOURCE_REMOVE;
        }),
      );
    } else if (entry === 'gesture') {
      controls.gestureBegin({ confirmSwipe() {} });
      Main.overview._gestureUpdate(null, 0.05);
    } else {
      Main.overview.show();
    }
    const monitors = new Set();
    try {
      for (let frame = 0; frame < 4; frame++) {
        if (entry === 'gesture')
          Main.overview._gestureUpdate(null, 0.05 + frame * 0.3);
        // Applying a still image can replace backgrounds while entry is running.
        if (frame === 1)
          settings.set_string(
            'primary-color',
            settings.get_string('primary-color') === '#FF0000'
              ? '#EE0000'
              : '#FF0000',
          );
        const image = await capturePixels();
        // Scan the captured pixels, not actor positions from a later animation frame.
        for (const { index, red, green } of scan(image)) {
          if (green > 20) monitors.add(index);
          if (!red) continue;
          image.savev(
            `${GLib.getenv('WALLSHADER_ARTIFACTS')}/overview-transition-failure.png`,
            'png',
            [],
            [],
          );
          throw new Error(
            `Overview flashed the saved still: entry=${entry}, paused=${paused}, frame=${frame}, monitor=${index}, red=${red}`,
          );
        }
      }
    } finally {
      global.stage.disconnect(paintId);
      if (entry === 'gesture') Main.overview._gestureEnd(null, 0, 1);
    }
    assert(paints > 0, 'Overview transition did not paint');
    if (paintError) throw paintError;
    assert(
      monitors.size === Main.layoutManager.monitors.length,
      'Overview transition missed a monitor',
    );
    Main.overview.hide();
    await delay(500);
  }
  assert(extension._process === process, 'Overview restarted the renderer');
  await rpc('SetPaused', new GLib.Variant('(b)', [false]));
  console.log(
    'Verified live pixels from the first overview frame across repeated entries.',
  );
}

async function checkOverviewCorners(extension) {
  const entries = [...extension._overview._backgrounds.values()];
  const livePixels = await capturePixels();
  let nativePixels;
  try {
    for (const { live } of entries) live.effect.enabled = false;
    await delay(150);
    nativePixels = await capturePixels();
  } finally {
    for (const { live } of entries) live.effect.enabled = true;
  }
  const liveData = livePixels.get_pixels();
  const nativeData = nativePixels.get_pixels();
  const monitors = new Set();
  let corners = 0;
  for (const { live, thumbnail } of entries) {
    if (thumbnail || !live.actor.mapped) continue;
    assert(
      live.actor.content.rounded_clip_radius > 0,
      'GNOME overview mask has no rounding',
    );
    const index = live.actor.content.monitor;
    const monitor = Main.layoutManager.monitors[index];
    const area = Main.layoutManager.getWorkAreaForMonitor(index);
    // BackgroundContent maps monitor coordinates into the preview allocation.
    const scaleX = live.actor.width / monitor.width;
    const scaleY = live.actor.height / monitor.height;
    const left = (area.x - monitor.x) * scaleX;
    const top = (area.y - monitor.y) * scaleY;
    const width = area.width * scaleX;
    const height = area.height * scaleY;
    const points = [
      [left + 1, top + 1],
      [left + width - 1, top + 1],
      [left + 1, top + height - 1],
      [left + width - 1, top + height - 1],
      [left + width / 2, top + height / 2],
    ];
    for (const [position, [x, y]] of points.entries()) {
      const point = live.actor.apply_relative_transform_to_point(
        global.stage,
        new Graphene.Point3D({ x, y, z: 0 }),
      );
      if (
        point.x < monitor.x ||
        point.y < monitor.y ||
        point.x >= monitor.x + monitor.width ||
        point.y >= monitor.y + monitor.height
      )
        continue;
      const pixelX = Math.floor(
        (point.x * livePixels.width) / global.stage.width,
      );
      const pixelY = Math.floor(
        (point.y * livePixels.height) / global.stage.height,
      );
      const offset =
        pixelY * livePixels.rowstride + pixelX * livePixels.n_channels;
      let difference = 0;
      for (let channel = 0; channel < 3; channel++)
        difference += Math.abs(
          liveData[offset + channel] - nativeData[offset + channel],
        );
      if (position === 4) {
        assert(
          difference > 30,
          `Overview monitor ${index} has no visible shader pixels`,
        );
        monitors.add(index);
      } else {
        assert(
          difference <= 6,
          `Shader painted over GNOME's rounded corner on monitor ${index}: ${difference}`,
        );
        corners++;
      }
    }
  }
  assert(
    monitors.size === Main.layoutManager.monitors.length &&
      corners >= 4 * monitors.size,
    `Rounded corner checks missed a monitor: monitors=${[...monitors]}, corners=${corners}`,
  );
  console.log(
    'Verified live overview pixels and native rounded corners on every monitor.',
  );
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
    await checkDesktopLaunch();
    await checkDesktopMenuPreference(extension);
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
    await checkOverviewTransition(extension);
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
    const primaryPreviews = [
      ...extension._overview._backgrounds.values(),
    ].filter(
      ({ live, thumbnail }) =>
        !thumbnail &&
        live.actor.content.monitor === Main.layoutManager.primaryIndex,
    );
    assert(
      primaryPreviews.length === 4,
      'New workspace did not receive the live background',
    );
    const previousBackground =
      Main.layoutManager._bgManagers[0].backgroundActor;
    const backgroundSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.background',
    });
    backgroundSettings.set_string('picture-options', 'none');
    backgroundSettings.set_string('primary-color', '#182030');
    await until(
      () =>
        Main.layoutManager._bgManagers[0].backgroundActor !==
          previousBackground &&
        Main.layoutManager._bgManagers.every(({ backgroundActor }) =>
          extension._desktop._backgrounds.has(backgroundActor),
        ),
      'Replaced GNOME backgrounds lost the live wallpaper',
    );
    checkDesktopMenus();
    await delay(300);
    checkOverview(extension);
    await checkCoverage(extension);
    const overviewFirst = await inspect();
    await screenshot('live-overview-first');
    await delay(1000);
    const overviewNext = await inspect();
    assert(
      overviewNext.frames.every(
        (frame, index) => frame > overviewFirst.frames[index] + 100,
      ),
      `Overview shader did not animate: ${overviewFirst.frames} -> ${overviewNext.frames}`,
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
    await checkOverviewCorners(extension);
    await rpc('SetPaused', new GLib.Variant('(b)', [false]));
    Main.overview.hide();
    await delay(800);
    assert(
      extension._overview._backgrounds.size === 0 &&
        extension._overview._watched.size === 0 &&
        extension._overview._pending === 0,
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
    checkDesktopMenus();
    await checkCoverage(extension);
    // GNOME closes Activities on a monitor layout change.
    Main.overview.show();
    await delay(800);
    checkOverview(extension);
    const process = extension._process;
    const desktopBackgrounds = [...extension._desktop._backgrounds.keys()];
    await rpc('Stop');
    checkDesktopMenus();
    assert(
      extension._desktop._backgrounds.size === 0 &&
        extension._desktop._hidden.size === 0 &&
        extension._desktop._pending === 0 &&
        desktopBackgrounds.every(
          (actor) => !actor.get_effect('wallshader-background'),
        ),
      'Stop left desktop effects or hidden windows',
    );
    assert(
      !JSON.parse(extension.GetStatus()).compositing,
      'Stopping retained the wallpaper compositor inhibitor',
    );
    assert(
      extension._overview._backgrounds.size === 0 &&
        extension._overview._watched.size === 0 &&
        extension._overview._pending === 0,
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
    checkDesktopMenus(false);
    assert(
      extension._desktopMenu._pending === 0 &&
        extension._desktopMenu._monitor === null &&
        extension._desktopMenu._items.size === 0 &&
        extension._desktopMenu._managers.size === 0,
      'Disable left desktop menu items, signals, or pending work',
    );
    assert(
      extension._desktop._backgrounds.size === 0 &&
        extension._desktop._hidden.size === 0 &&
        extension._desktop._pending === 0,
      'Disable left desktop effects or hidden windows',
    );
    assert(
      !JSON.parse(extension.GetStatus()).compositing,
      'Disabling retained the wallpaper compositor inhibitor',
    );
    assert(
      extension._overview._backgrounds.size === 0 &&
        extension._overview._watched.size === 0 &&
        extension._overview._pending === 0,
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

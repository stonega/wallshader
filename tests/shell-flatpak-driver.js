import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const APP_ID = 'io.github.stonega.wallshader';
const LIVE_BUS = 'io.github.wallshader.Live';
const UUID = 'wallshader@wallshader.github.io';
const delay = (ms) =>
  new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function until(callback, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await callback()) return;
    await delay(200);
  }
  throw new Error(message);
}
function call(destination, path, iface, method, parameters = null) {
  return new Promise((resolve, reject) =>
    Gio.DBus.session.call(
      destination,
      path,
      iface,
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
const portal = async (method, parameters) =>
  call(
    'org.freedesktop.portal.Desktop',
    '/org/freedesktop/portal/desktop',
    `${APP_ID}.Test`,
    method,
    parameters,
  );
const ownsName = async (name) =>
  (
    await call(
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'NameHasOwner',
      new GLib.Variant('(s)', [name]),
    )
  )[0];
async function screenshot(name) {
  const file = Gio.File.new_for_path(
    `${GLib.getenv('WALLSHADER_ARTIFACTS')}/${name}.png`,
  );
  const stream = file.replace(
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
  return GdkPixbuf.Pixbuf.new_from_file(file.get_path());
}
function checkAnimationPixels(first, second) {
  const before = first.get_pixels();
  const after = second.get_pixels();
  for (const [index, monitor] of Main.layoutManager.monitors.entries()) {
    const minimum = [255, 255, 255];
    const maximum = [0, 0, 0];
    let moving = 0;
    for (let row = 0; row < 20; row++) {
      for (let column = 0; column < 20; column++) {
        const x = monitor.x + monitor.width * (0.1 + column * 0.04);
        const y = monitor.y + monitor.height * (0.1 + row * 0.04);
        const pixelX = Math.floor((x * first.width) / global.stage.width);
        const pixelY = Math.floor((y * first.height) / global.stage.height);
        const offset = pixelY * first.rowstride + pixelX * first.n_channels;
        let difference = 0;
        for (let channel = 0; channel < 3; channel++) {
          const value = before[offset + channel];
          minimum[channel] = Math.min(minimum[channel], value);
          maximum[channel] = Math.max(maximum[channel], value);
          difference += Math.abs(value - after[offset + channel]);
        }
        if (difference > 6) moving++;
      }
    }
    assert(
      maximum.some((value, channel) => value - minimum[channel] > 40),
      `Monitor ${index} shows a blank or uniform wallpaper`,
    );
    assert(moving > 20, `Monitor ${index} has no visible animation`);
    console.log(
      `Verified changing shader pixels on monitor ${index}: ${moving}/400 samples`,
    );
  }
}

export default class FlatpakShellTest extends Extension {
  enable() {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      this._run()
        .then(() => this._result('PASS'))
        .catch((error) =>
          this._result(`FAIL: ${error.message}\n${error.stack}`),
        );
      return GLib.SOURCE_REMOVE;
    });
  }
  _result(message) {
    console.log(message);
    GLib.file_set_contents(
      GLib.getenv('WALLSHADER_SHELL_TEST_RESULT'),
      message,
    );
  }
  async _run() {
    Main.overview.hide();
    await delay(600);
    const extension = Main.extensionManager.lookup(UUID).stateObj;
    assert(extension?._enabled, 'Animation extension did not enable');
    await until(
      () => ownsName(LIVE_BUS),
      'Private animation service did not appear',
    );
    assert(
      extension._controlBus.get_unique_name() !==
        Gio.DBus.session.get_unique_name(),
      'Animation service must have a dedicated bus connection',
    );
    const [xml] = await call(
      LIVE_BUS,
      '/org/gnome/Shell',
      'org.freedesktop.DBus.Introspectable',
      'Introspect',
    );
    assert(
      !xml.includes('interface name="org.gnome.Shell'),
      'Animation service exposed Shell APIs',
    );
    const root = GLib.getenv('WALLSHADER_TEST_APP_DIR');
    this._editor = Gio.Subprocess.new(
      [
        'flatpak',
        'run',
        '--command=gjs',
        '--no-a11y-bus',
        '--no-documents-portal',
        `--filesystem=${root}/tests:ro`,
        '--env=GSETTINGS_BACKEND=memory',
        '--env=GTK_A11Y=none',
        '--env=WALLSHADER_LOCALEDIR=/app/share/locale',
        APP_ID,
        '-m',
        `${root}/tests/flatpak-live-client.js`,
      ],
      Gio.SubprocessFlags.NONE,
    );
    let editorExited = false;
    this._editor.wait_async(null, (process, result) => {
      process.wait_finish(result);
      editorExited = true;
    });
    await until(
      () => ownsName(APP_ID),
      'Flatpak editor did not register on D-Bus',
    );
    const editor = Gio.DBusActionGroup.get(
      Gio.DBus.session,
      APP_ID,
      '/io/github/stonega/wallshader',
    );
    const checkError = () => {
      const message = editor.get_action_state('test-error')?.deepUnpack();
      if (message) throw new Error(`Flatpak editor: ${message}`);
      assert(!editorExited, 'Flatpak editor exited early');
    };
    await until(() => {
      checkError();
      return editor.get_action_state('test-ready')?.deepUnpack();
    }, 'Flatpak editor did not become ready');
    Main.extensionManager.disableExtension(UUID);
    await until(
      async () => !(await ownsName(LIVE_BUS)),
      'Extension did not disable',
    );
    editor.activate_action('test-setup', null);
    await until(async () => {
      checkError();
      return extension._enabled && (await ownsName(LIVE_BUS));
    }, 'Flatpak did not enable its installed extension through GNOME');
    const apply = async (options) => {
      editor.activate_action(
        'test-apply',
        new GLib.Variant('s', JSON.stringify(options)),
      );
      await until(async () => {
        checkError();
        return JSON.parse((await portal('GetState'))[0]).pending > 0;
      }, 'Animated apply did not request a still frame through the portal');
      await portal('Respond', new GLib.Variant('(u)', [0]));
      await until(() => {
        checkError();
        if (extension._error) throw new Error(extension._error);
        return (
          extension._ready &&
          extension._config.backend === 'flatpak' &&
          extension._config.fps === (options.fps ?? 30) &&
          extension._config.rendering ===
            (options.rendering ?? 'compatibility') &&
          extension._windows.size === Main.layoutManager.monitors.length
        );
      }, 'Sandboxed renderer did not become ready');
    };
    const inspect = async () => {
      extension._actions.activate_action('inspect', null);
      await delay(400);
      return JSON.parse(
        extension._actions.get_action_state('diagnostics').deepUnpack(),
      );
    };
    await apply({});
    const firstProcess = extension._process;
    console.log(
      `Flatpak renderer diagnostics: ${JSON.stringify(await inspect())}`,
    );
    let rejectedNative = false;
    try {
      await call(
        LIVE_BUS,
        '/io/github/wallshader/Live',
        LIVE_BUS,
        'Apply',
        new GLib.Variant('(s)', [
          JSON.stringify({ ...extension._config, backend: 'native' }),
        ]),
      );
    } catch {
      rejectedNative = true;
    }
    assert(
      rejectedNative && extension._process === firstProcess,
      'Sandbox service accepted a host renderer request',
    );
    assert(
      (await inspect()).backend === 'flatpak',
      'Renderer is not running inside Flatpak',
    );
    for (const [window, managed] of extension._windows) {
      assert(
        extension._client.owns_window(window),
        'Renderer lost private Wayland ownership',
      );
      assert(
        window.get_window_type() === Meta.WindowType.DESKTOP,
        'Renderer is not a desktop window',
      );
      const monitor = Main.layoutManager.monitors[managed.index];
      const rect = window.get_frame_rect();
      assert(
        rect.x === monitor.x &&
          rect.y === monitor.y &&
          rect.width === monitor.width &&
          rect.height === monitor.height,
        'Renderer does not cover its monitor',
      );
    }
    const spoof = global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .find(
        (window) =>
          window.get_title() === 'Wallshader Desktop 0' &&
          !extension._client.owns_window(window),
      );
    assert(
      spoof && !extension._windows.has(spoof),
      'Matching-title editor window was claimed as wallpaper',
    );
    const first = await inspect();
    assert(
      first.geometry.every(
        ({ viewport, canvas, scale }) =>
          Number.isFinite(scale) &&
          scale > 0 &&
          viewport.every((size) => size > 0) &&
          canvas.every((size) => size > 0),
      ),
      'Sandboxed WebKit view has invalid scaling or an empty canvas',
    );
    await delay(600);
    const playing = await inspect();
    assert(
      playing.frames.every((frame, index) => frame > first.frames[index]),
      'Wallpaper is not animating on every monitor',
    );
    editor.activate_action('test-pause', new GLib.Variant('b', true));
    await until(
      () => extension._config.paused,
      'Flatpak Pause did not reach extension',
    );
    const paused = await inspect();
    await delay(600);
    assert(
      JSON.stringify((await inspect()).frames) ===
        JSON.stringify(paused.frames),
      'Paused Flatpak wallpaper advanced',
    );
    editor.activate_action('test-pause', new GLib.Variant('b', false));
    await until(
      () => !extension._config.paused,
      'Flatpak Resume did not reach extension',
    );
    await apply({ fps: 60, speed: -1 });
    assert(
      extension._process === firstProcess,
      'Same-backend apply restarted the renderer',
    );
    const reverse = await inspect();
    await delay(500);
    assert(
      (await inspect()).frames.every(
        (frame, index) => frame < reverse.frames[index],
      ),
      'Reverse animation did not reach sandbox renderer',
    );
    await apply({ rendering: 'gpu' });
    assert(
      extension._process !== firstProcess,
      'Rendering mode change did not restart sandbox',
    );
    assert(
      (await inspect()).skiaCpuRendering === '0',
      'Flatpak renderer ignored GPU mode environment',
    );
    extension.Apply(
      JSON.stringify({ ...extension._config, backend: 'native' }),
    );
    await until(
      () =>
        extension._ready &&
        extension._processBackend === 'native' &&
        extension._windows.size === Main.layoutManager.monitors.length,
      'Flatpak-to-native handoff failed',
    );
    assert(
      (await inspect()).backend === 'native',
      'Native handoff used Flatpak',
    );
    await apply({});
    assert(
      extension._processBackend === 'flatpak' &&
        (await inspect()).backend === 'flatpak',
      'Native-to-Flatpak handoff failed',
    );
    editor.activate_action('test-stop', null);
    await until(
      () =>
        !extension._process &&
        !extension._stopping &&
        extension._windows.size === 0,
      'Flatpak Stop did not clean up renderer',
    );
    await until(
      async () => !(await ownsName(`${APP_ID}.Renderer`)),
      'Stopped sandbox renderer retained its bus name',
    );
    await apply({});
    const detachedProcess = extension._process;
    editor.activate_action('quit', null);
    await until(() => editorExited, 'Editor did not close');
    const detached = await inspect();
    console.log(
      `Detached Flatpak renderer diagnostics: ${JSON.stringify(detached)}`,
    );
    await delay(600);
    assert(
      extension._process === detachedProcess &&
        (await inspect()).frames.every(
          (frame, index) => frame > detached.frames[index],
        ),
      'Wallpaper stopped when the editor closed',
    );
    Main.overview.hide();
    await delay(600);
    const desktop = await screenshot('flatpak-live-desktop');
    await delay(700);
    checkAnimationPixels(
      desktop,
      await screenshot('flatpak-live-desktop-next'),
    );
    Main.overview.show();
    await delay(800);
    await screenshot('flatpak-live-overview');
    Main.overview.hide();
    await delay(400);
    assert(
      Main.layoutManager.panelBox.visible,
      'Sandboxed wallpaper hid top bar',
    );
    Main.extensionManager.disableExtension(UUID);
    await until(
      async () =>
        !(await ownsName(LIVE_BUS)) && !(await ownsName(`${APP_ID}.Renderer`)),
      'Disable left service or renderer alive',
    );
    assert(
      extension._windows.size === 0 && !extension._compositing.held,
      'Disable left managed windows or compositing hold',
    );
    // Login restores the host's persisted backend without reopening the editor.
    Main.extensionManager.enableExtension(UUID);
    await until(
      () =>
        extension._enabled &&
        extension._ready &&
        extension._windows.size === Main.layoutManager.monitors.length,
      'Saved Flatpak animation did not resume after enabling the extension',
    );
    assert(
      extension._config.backend === 'flatpak' &&
        (await inspect()).backend === 'flatpak',
      'Saved configuration resumed outside Flatpak',
    );
    extension.Stop();
    await until(() => !extension._stopping, 'Resumed renderer did not stop');
    // Cancel at different stages of Flatpak supervisor and app startup.
    for (const startupDelay of [0, 25, 100, 300, 700]) {
      extension.Apply(JSON.stringify(extension._config));
      await delay(startupDelay);
      extension.Stop();
      await until(
        () => !extension._stopping && extension._windows.size === 0,
        'Startup cancellation left renderer resources',
      );
      await delay(1000);
      assert(
        !(await ownsName(`${APP_ID}.Renderer`)) && !extension._process,
        `Cancelled sandbox appeared after Stop (${startupDelay} ms startup)`,
      );
      console.log(
        `Verified Flatpak startup cancellation after ${startupDelay} ms`,
      );
    }
    Main.extensionManager.disableExtension(UUID);
    await until(
      async () => !(await ownsName(LIVE_BUS)),
      'Control service survived final disable',
    );
    console.log(
      'Verified real Flatpak animation, two-monitor pixels and ownership, title isolation, pause/resume, reverse/60 FPS, mode and backend restarts, stop, editor independence, overview, startup cancellation and disable cleanup.',
    );
  }
  disable() {
    if (this._editor) {
      try {
        this._editor.send_signal(15);
      } catch {}
      this._editor = null;
    }
  }
}

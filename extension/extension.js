import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { OverviewWallpapers } from './overview.js';
import { CompositingHold } from './compositing.js';
import {
  LIVE_XML,
  LIVE_PATH,
  RENDERER_ID,
  RENDERER_PATH,
  parseLiveConfig,
  normalizeLiveConfig,
  coversMonitor,
} from './app/src/live-config.js';
import { readJson, writeJson } from './app/src/storage.js';

export default class WallshaderExtension extends Extension {
  enable() {
    this._enabled = true;
    this._compositing = new CompositingHold(global.compositor);
    this._windows = new Map();
    this._overview = new OverviewWallpapers((index) => {
      for (const [window, managed] of this._windows) {
        if (managed.index === index) return window.get_compositor_private();
      }
      return null;
    });
    this._sources = new Set();
    this._signals = [];
    this._error = '';
    this._ready = false;
    this._reason = '';
    this._path = GLib.build_filenamev([
      GLib.get_user_config_dir(),
      'wallshader',
      'live-wallpaper.json',
    ]);
    this._dbus = Gio.DBusExportedObject.wrapJSObject(LIVE_XML, this);
    this._dbus.export(Gio.DBus.session, LIVE_PATH);
    this._connect(global.display, 'window-created', (_display, window) =>
      this._manage(window),
    );
    this._connect(global.window_manager, 'map', (_manager, actor) => {
      this._manage(actor.meta_window);
      this._updatePause();
    });
    // Refresh before the next repaint when an application uncovers the desktop.
    this._connect(global.display, 'restacked', () => this._updatePause());
    for (const signal of ['minimize', 'unminimize', 'destroy'])
      this._connect(global.window_manager, signal, () => this._updatePause());
    this._connect(Main.layoutManager, 'monitors-changed', () => {
      if (this._config?.enabled) {
        this._stop();
        this._start();
      }
    });
    this._connect(Main.overview, 'showing', () => {
      if (this._process) this._overview.sync();
      this._updatePause();
    });
    this._connect(Main.overview, 'hidden', () => {
      this._overview.clear();
      this._updatePause();
    });
    this._connect(Main.sessionMode, 'updated', () => this._updatePause());
    // Re-evaluate coverage as soon as the destination workspace becomes active.
    // Visible wallpaper needs the compositing hold before the next repaint.
    this._connect(global.workspace_manager, 'active-workspace-changed', () =>
      this._updatePause(),
    );
    this._periodic = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this._updatePause();
      return GLib.SOURCE_CONTINUE;
    });
    try {
      const saved = readJson(this._path);
      if (saved) this._config = normalizeLiveConfig(saved);
      if (this._config?.enabled) this._start();
    } catch (error) {
      this._error = error.message;
    }
    this._notify();
  }

  _connect(object, signal, callback) {
    this._signals.push([object, object.connect(signal, callback)]);
  }

  GetStatus() {
    return JSON.stringify({
      available: true,
      active: Boolean(this._process),
      ready: this._ready,
      paused: Boolean(this._reason),
      reason: this._reason,
      manualPaused: this._config?.paused ?? false,
      error: this._error,
      name: this._config?.preset.name ?? '',
      fps: this._config?.fps ?? 30,
      monitors: this._windows.size,
      compositing: this._compositing.held,
      panelVisible: Main.layoutManager.panelBox.visible,
      fullscreenMonitors: Main.layoutManager.monitors
        .filter((monitor) =>
          global.display.get_monitor_in_fullscreen(monitor.index),
        )
        .map((monitor) => monitor.index),
    });
  }

  Apply(source) {
    this._config = { ...parseLiveConfig(source), enabled: true };
    writeJson(this._path, this._config);
    this._error = '';
    if (this._process && this._ready)
      this._actions?.activate_action('reload', null);
    else if (this._process) this._needsReload = true;
    else this._start();
    this._updatePause();
    this._notify();
  }

  Stop() {
    if (this._config) {
      this._config.enabled = false;
      writeJson(this._path, this._config);
    }
    this._stop();
    this._error = '';
    this._notify();
  }

  SetPaused(paused) {
    if (!this._config) return;
    this._config.paused = paused;
    writeJson(this._path, this._config);
    this._updatePause();
  }

  _notify() {
    this._dbus?.emit_signal(
      'Changed',
      new GLib.Variant('(s)', [this.GetStatus()]),
    );
  }

  async _start() {
    if (this._stopping) await this._stopping;
    if (!this._enabled || this._process || !this._config?.enabled) return;
    const monitors = Main.layoutManager.monitors.map(
      ({ index, x, y, width, height }) => ({ index, x, y, width, height }),
    );
    if (!monitors.length) return;
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.NONE,
    });
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.unsetenv('DISPLAY');
    // Do not let a desktop startup token transfer focus to the renderer.
    launcher.unsetenv('XDG_ACTIVATION_TOKEN');
    launcher.unsetenv('DESKTOP_STARTUP_ID');
    try {
      this._setCompositing(true);
      this._client = Meta.WaylandClient.new_subprocess(
        global.context,
        launcher,
        [
          'gjs',
          '-m',
          GLib.build_filenamev([
            this.path,
            'app',
            'src',
            'desktop-renderer.js',
          ]),
          JSON.stringify(monitors),
        ],
      );
      const process = this._client.get_subprocess();
      this._process = process;
      this._ready = false;
      this._rendererWatch = Gio.bus_watch_name(
        Gio.BusType.SESSION,
        RENDERER_ID,
        Gio.BusNameWatcherFlags.NONE,
        (_connection, _name, owner) => {
          if (!this._enabled || this._process !== process || this._actions)
            return;
          this._actions = Gio.DBusActionGroup.get(
            Gio.DBus.session,
            owner,
            RENDERER_PATH,
          );
          this._actionAdded = this._actions.connect('action-added', () =>
            this._checkReady(),
          );
          this._actionChanged = this._actions.connect(
            'action-state-changed',
            () => this._checkReady(),
          );
          this._checkReady();
        },
        () => {},
      );
      this._startup = this._later(30000, () => {
        if (this._ready) return;
        this._error =
          'The wallpaper renderer did not start. Check WebKitGTK and WebGL support.';
        this._stop(false);
        this._notify();
      });
      process.wait_async(null, (child, result) => {
        try {
          child.wait_finish(result);
        } catch (error) {
          console.warn(error.message);
        }
        if (!this._enabled || this._process !== process) return;
        this._error =
          'The wallpaper renderer stopped. Apply the wallpaper again to restart it.';
        this._stop();
        this._notify();
      });
    } catch (error) {
      this._error = error.message;
      this._stop();
    } finally {
      launcher.close();
    }
    this._notify();
  }

  _later(delay, callback) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._sources.delete(id);
      callback();
      return GLib.SOURCE_REMOVE;
    });
    this._sources.add(id);
    return id;
  }

  _checkReady() {
    if (!this._actions?.has_action('ready')) return;
    const ready = this._actions.get_action_state('ready')?.deepUnpack();
    if (!ready || this._ready) return;
    this._ready = true;
    if (this._needsReload) {
      this._needsReload = false;
      this._actions.activate_action('reload', null);
    }
    if (this._sources.delete(this._startup)) GLib.source_remove(this._startup);
    this._updatePause(true);
    this._notify();
  }

  _manage(window) {
    if (!this._client?.owns_window(window) || this._windows.has(window)) return;
    const index = Number(
      /^Wallshader Desktop (\d+)$/.exec(window.get_title() ?? '')?.[1],
    );
    const monitor = Main.layoutManager.monitors[index];
    if (!monitor) return;
    // GNOME 50's desktop window type provides stacking, workspace and overview
    // behavior without replacing Shell methods or changing unrelated windows.
    window.set_type(Meta.WindowType.DESKTOP);
    window.unmaximize();
    window.hide_from_window_list();
    window.stick();
    window.move_to_monitor(index);
    const managed = { index, signals: [], placement: 0 };
    const place = () => {
      // Mutter hides the panel for fullscreen windows, even desktop windows.
      // Keep full monitor bounds without retaining that window state.
      if (window.is_fullscreen()) window.unmake_fullscreen();
      const rect = window.get_frame_rect();
      if (
        rect.x === monitor.x &&
        rect.y === monitor.y &&
        rect.width === monitor.width &&
        rect.height === monitor.height
      )
        return;
      window.move_resize_frame(
        false,
        monitor.x,
        monitor.y,
        monitor.width,
        monitor.height,
      );
    };
    // Wayland configures can arrive after shown and shrink the client to the
    // work area. Restore full monitor bounds after geometry changes settle.
    const queuePlacement = () => {
      if (managed.placement) return;
      managed.placement = this._later(0, () => {
        managed.placement = 0;
        place();
      });
    };
    managed.signals = [
      window.connect('shown', () => {
        queuePlacement();
        window.lower();
      }),
      window.connect('size-changed', queuePlacement),
      window.connect('position-changed', queuePlacement),
      window.connect('notify::fullscreen', queuePlacement),
      window.connect('unmanaged', () => this._release(window)),
    ];
    this._windows.set(window, managed);
    place();
    this._overview.sync();
    this._updatePause();
    this._notify();
  }

  _release(window) {
    const managed = this._windows.get(window);
    if (!managed) return;
    this._windows.delete(window);
    this._overview.sync();
    if (this._sources.delete(managed.placement))
      GLib.source_remove(managed.placement);
    for (const id of managed.signals) window.disconnect(id);
    this._updatePause();
  }

  _setCompositing(required) {
    const changed = this._compositing.setRequired(required);
    if (changed) global.stage.queue_redraw();
    return changed;
  }

  _desktopCovered() {
    const workspace = global.workspace_manager.get_active_workspace();
    const covering = global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .filter(
        (window) =>
          !this._windows.has(window) &&
          !window.minimized &&
          window.located_on_workspace(workspace) &&
          window.get_window_type() === Meta.WindowType.NORMAL,
      );
    return Main.layoutManager.monitors.every((monitor) =>
      covering.some((window) =>
        coversMonitor(
          window.get_frame_rect(),
          workspace.get_work_area_for_monitor(monitor.index),
        ),
      ),
    );
  }

  _updatePause(force = false) {
    if (!this._process) return;
    const covered = !Main.overview.visible && this._desktopCovered();
    // A monitor-sized Wayland surface can qualify for direct scanout even
    // without fullscreen state. Keep visible wallpaper beneath Shell chrome.
    // Coverage, not playback state, decides this: manual pause still shows it.
    const compositingChanged = this._setCompositing(
      (this._windows.size > 0 || !this._ready) && !covered,
    );
    // Only the user's pause control changes playback. Coverage and session
    // transitions must not restart the renderer's animation clock.
    const reason = this._config.paused ? 'Paused' : '';
    const playbackChanged = force || reason !== this._reason;
    if (playbackChanged) {
      this._reason = reason;
      if (this._ready)
        this._actions.activate_action(
          'pause',
          new GLib.Variant('b', Boolean(reason)),
        );
    }
    if (playbackChanged || compositingChanged) this._notify();
  }

  _stop(terminate = true) {
    for (const id of this._sources) GLib.source_remove(id);
    this._sources.clear();
    if (this._rendererWatch) Gio.bus_unwatch_name(this._rendererWatch);
    this._rendererWatch = null;
    if (this._actions) {
      if (this._actionAdded) this._actions.disconnect(this._actionAdded);
      if (this._actionChanged) this._actions.disconnect(this._actionChanged);
      this._actions = null;
    }
    const process = this._process;
    this._process = null;
    this._client = null;
    this._ready = false;
    this._reason = '';
    for (const window of [...this._windows.keys()]) this._release(window);
    this._overview.clear();
    this._setCompositing(false);
    // This handle identifies only the renderer we own, never another application.
    if (process && terminate) {
      process.send_signal(15);
      const stopped = new Promise((resolve) =>
        process.wait_async(null, (child, result) => {
          try {
            child.wait_finish(result);
          } catch (error) {
            console.warn(error.message);
          }
          if (this._stopping === stopped) this._stopping = null;
          resolve();
        }),
      );
      this._stopping = stopped;
    }
  }

  disable() {
    this._enabled = false;
    this._stop();
    if (this._periodic) GLib.source_remove(this._periodic);
    this._periodic = 0;
    for (const [object, id] of this._signals) object.disconnect(id);
    this._signals = [];
    this._dbus?.unexport();
    this._dbus = null;
    this._config = null;
  }
}

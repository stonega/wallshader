import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { OverviewWallpapers } from './overview.js';
import { DesktopWallpapers } from './background.js';
import { CompositingHold } from './compositing.js';
import { DesktopMenu } from './desktop-menu.js';
import {
  LIVE_XML,
  LIVE_PATH,
  LIVE_BUS,
  FLATPAK_ID,
  rendererIdentity,
  parseLiveConfig,
  normalizeLiveConfig,
  coversMonitor,
} from './app/src/live-config.js';
import { readJson, writeJson } from './app/src/storage.js';

export default class WallshaderExtension extends Extension {
  enable() {
    this._enabled = true;
    this._desktopMenu = new DesktopMenu(this.path);
    this._compositing = new CompositingHold(global.compositor);
    this._windows = new Map();
    const sourceForMonitor = (index) => {
      for (const [window, managed] of this._windows) {
        if (managed.index === index) return window.get_compositor_private();
      }
      return null;
    };
    this._desktop = new DesktopWallpapers(sourceForMonitor);
    this._overview = new OverviewWallpapers(sourceForMonitor);
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
    // Use a separate connection so this name exposes only Wallshader's control
    // interface, without granting sandboxed editors access to Shell's APIs.
    this._controlBus = Gio.DBusConnection.new_for_address_sync(
      Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, null),
      Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
      null,
      null,
    );
    this._controlBus.set_exit_on_close(false);
    this._controlDbus = Gio.DBusExportedObject.wrapJSObject(LIVE_XML, {
      GetStatus: () => this.GetStatus(),
      Apply: (source) => {
        if (parseLiveConfig(source).backend !== 'flatpak')
          throw new Error(
            'The sandbox control service only accepts Flatpak renderers.',
          );
        this.Apply(source);
      },
      Stop: () => this.Stop(),
      SetPaused: (paused) => this.SetPaused(paused),
    });
    this._controlDbus.export(this._controlBus, LIVE_PATH);
    this._controlOwner = Gio.bus_own_name_on_connection(
      this._controlBus,
      LIVE_BUS,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
    );
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
      this._desktopMenu.backend = this._config?.backend;
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
      backends: ['native', 'flatpak'],
      backend: this._config?.backend ?? 'native',
      active: Boolean(this._process),
      ready: this._ready,
      paused: Boolean(this._reason),
      reason: this._reason,
      manualPaused: this._config?.paused ?? false,
      error: this._error,
      name: this._config?.preset.name ?? '',
      fps: this._config?.fps ?? 30,
      rendering: this._config?.rendering ?? 'compatibility',
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
    const config = { ...parseLiveConfig(source), enabled: true };
    writeJson(this._path, config);
    const renderingChanged =
      config.rendering !== this._config?.rendering ||
      config.backend !== this._config?.backend;
    this._config = config;
    this._desktopMenu.backend = config.backend;
    this._error = '';
    // WebKit reads the drawing backend at startup, before creating any views.
    if (this._process && renderingChanged) this._stop();
    if (this._process && this._ready) this._configureRenderer();
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
    this._controlDbus?.emit_signal(
      'Changed',
      new GLib.Variant('(s)', [this.GetStatus()]),
    );
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
    launcher.setenv(
      'WEBKIT_SKIA_ENABLE_CPU_RENDERING',
      this._config.rendering === 'gpu' ? '0' : '1',
      true,
    );
    launcher.unsetenv('DISPLAY');
    // Do not let a desktop startup token transfer focus to the renderer.
    launcher.unsetenv('XDG_ACTIVATION_TOKEN');
    launcher.unsetenv('DESKTOP_STARTUP_ID');
    try {
      const flatpak = this._config.backend === 'flatpak';
      if (flatpak && !GLib.find_program_in_path('flatpak'))
        throw new Error(
          'Install Flatpak 1.18 or newer to run animated wallpapers.',
        );
      const script = flatpak
        ? '/app/share/wallshader/src/desktop-renderer.js'
        : GLib.build_filenamev([
            this.path,
            'app',
            'src',
            'desktop-renderer.js',
          ]);
      const command = flatpak
        ? [
            'flatpak',
            'run',
            // Also kill the sandbox if Stop interrupts its startup supervisor.
            '--die-with-parent',
            '--socket=inherit-wayland-socket',
            '--command=gjs',
            '--env=GDK_BACKEND=wayland',
            `--env=WEBKIT_SKIA_ENABLE_CPU_RENDERING=${this._config.rendering === 'gpu' ? '0' : '1'}`,
            FLATPAK_ID,
          ]
        : ['gjs'];
      this._setCompositing(true);
      this._client = Meta.WaylandClient.new_subprocess(
        global.context,
        launcher,
        [
          ...command,
          '-m',
          script,
          JSON.stringify(monitors),
          JSON.stringify(this._config),
        ],
      );
      const process = this._client.get_subprocess();
      this._process = process;
      this._processBackend = this._config.backend;
      this._ready = false;
      this._rendererWatch = Gio.bus_watch_name(
        Gio.BusType.SESSION,
        rendererIdentity(this._config.backend).id,
        Gio.BusNameWatcherFlags.NONE,
        (_connection, _name, owner) => {
          if (!this._enabled || this._process !== process || this._actions)
            return;
          this._actions = Gio.DBusActionGroup.get(
            Gio.DBus.session,
            owner,
            rendererIdentity(this._config.backend).path,
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
        this._stop();
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
      this._configureRenderer();
    }
    if (this._sources.delete(this._startup)) GLib.source_remove(this._startup);
    this._updatePause(true);
    this._notify();
  }

  _configureRenderer() {
    this._actions?.activate_action(
      'configure',
      new GLib.Variant('s', JSON.stringify(this._config)),
    );
  }

  _manage(window) {
    if (!this._client?.owns_window(window) || this._windows.has(window)) return;
    const index = Number(
      /^Wallshader Desktop (\d+)$/.exec(window.get_title() ?? '')?.[1],
    );
    const monitor = Main.layoutManager.monitors[index];
    if (!monitor) return;
    // GNOME 50+ desktop window type provides stacking, workspace and overview
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
    this._desktop.sync();
    this._overview.sync();
    this._updatePause();
    this._notify();
  }

  _release(window) {
    const managed = this._windows.get(window);
    if (!managed) return;
    this._windows.delete(window);
    this._desktop.sync();
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
    this._desktop.setVisible(!covered);
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
    const actions = this._actions;
    const flatpak = this._processBackend === 'flatpak';
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
    this._processBackend = null;
    this._client = null;
    this._ready = false;
    this._reason = '';
    this._needsReload = false;
    for (const window of [...this._windows.keys()]) this._release(window);
    this._overview.clear();
    this._desktop.clear();
    this._setCompositing(false);
    // This handle identifies only the renderer we own, never another application.
    if (process && terminate) {
      // Ask the application to close before its Flatpak supervisor exits. This
      // releases the renderer's bus name before starting a replacement sandbox.
      let stopWatch = 0;
      let stopActions;
      let stopAdded = 0;
      if (actions?.has_action('quit')) actions.activate_action('quit', null);
      else if (flatpak) {
        // Killing the supervisor while it forks can strand a starting sandbox.
        // Let registration finish, then close the app before its first frame.
        stopWatch = Gio.bus_watch_name(
          Gio.BusType.SESSION,
          rendererIdentity('flatpak').id,
          Gio.BusNameWatcherFlags.NONE,
          (_connection, _name, owner) => {
            if (stopAdded) stopActions.disconnect(stopAdded);
            stopActions = Gio.DBusActionGroup.get(
              Gio.DBus.session,
              owner,
              rendererIdentity('flatpak').path,
            );
            const quit = () => {
              if (stopActions.has_action('quit'))
                stopActions.activate_action('quit', null);
            };
            stopAdded = stopActions.connect('action-added', quit);
            quit();
          },
          () => {},
        );
      } else process.send_signal(15);
      const terminateTimeout = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        2000,
        () => {
          process.send_signal(15);
          return GLib.SOURCE_REMOVE;
        },
      );
      const stopped = new Promise((resolve) =>
        process.wait_async(null, (child, result) => {
          try {
            child.wait_finish(result);
          } catch (error) {
            console.warn(error.message);
          }
          if (this._stopping === stopped) this._stopping = null;
          if (stopWatch) Gio.bus_unwatch_name(stopWatch);
          if (stopAdded) stopActions.disconnect(stopAdded);
          // The timeout may already have fired when startup failed.
          if (GLib.MainContext.default().find_source_by_id(terminateTimeout))
            GLib.source_remove(terminateTimeout);
          resolve();
        }),
      );
      this._stopping = stopped;
    }
  }

  disable() {
    this._enabled = false;
    this._desktopMenu.destroy();
    this._stop();
    this._desktop.destroy();
    if (this._periodic) GLib.source_remove(this._periodic);
    this._periodic = 0;
    for (const [object, id] of this._signals) object.disconnect(id);
    this._signals = [];
    this._dbus?.unexport();
    this._dbus = null;
    this._controlDbus?.unexport();
    this._controlDbus = null;
    if (this._controlOwner) Gio.bus_unown_name(this._controlOwner);
    this._controlOwner = 0;
    if (this._controlBus && !this._controlBus.is_closed())
      this._controlBus.close_sync(null);
    this._controlBus = null;
    this._config = null;
  }
}

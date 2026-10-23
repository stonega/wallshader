import { _ } from './i18n.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { syncExtension } from './extension-install.js';
import {
  EXTENSION_UUID,
  LIVE_INTERFACE,
  LIVE_PATH,
  normalizeLiveConfig,
} from './live-config.js';

// Shell releases whose desktop window and overview internals this extension
// is verified against.
const SUPPORTED_GNOME_MAJORS = [50, 51];

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

export class LoginRequiredError extends Error {
  constructor(updated = false) {
    super(
      updated
        ? _(
            'Animation support was updated automatically. Log out and back in to load the updated extension. Then open Wallshader and choose “Set Animated Wallpaper” again.',
          )
        : _(
            'Animation support is installed. Log out and back in once so GNOME can discover it. Then open Wallshader and choose “Set Animated Wallpaper” again.',
          ),
    );
    this.updated = updated;
    this.name = 'LoginRequiredError';
  }
}

export class LiveWallpaper {
  constructor(onChange = () => {}) {
    this.status = { available: false, active: false };
    this._onChange = onChange;
    this._subscription = Gio.DBus.session.signal_subscribe(
      'org.gnome.Shell',
      LIVE_INTERFACE,
      'Changed',
      LIVE_PATH,
      null,
      Gio.DBusSignalFlags.NONE,
      (_connection, _sender, _path, _iface, _signal, parameters) => {
        this._setStatus(JSON.parse(parameters.deepUnpack()[0]));
      },
    );
  }

  _setStatus(status) {
    if (this._shellId && status.available) {
      this._shellChanged = status.shellBuildId !== this._shellId;
    }
    this.status = {
      ...status,
      loginRequired: Boolean(status.available && this._shellChanged),
    };
    this._onChange(this.status);
  }

  async initialize() {
    const result = syncExtension();
    this._shellId = result.shellId;
    this._shellChanged ||= result.shellChanged;
    await this.refresh();
    if (this.status.loginRequired) throw new LoginRequiredError(true);
  }

  async refresh() {
    let status;
    try {
      const [source] = await call(
        'org.gnome.Shell',
        LIVE_PATH,
        LIVE_INTERFACE,
        'GetStatus',
      );
      status = JSON.parse(source);
    } catch {
      status = { available: false, active: false };
    }
    this._setStatus(status);
    return this.status;
  }

  async setUp() {
    const [version] = await call(
      'org.gnome.Shell.Extensions',
      '/org/gnome/Shell/Extensions',
      'org.freedesktop.DBus.Properties',
      'Get',
      new GLib.Variant('(ss)', ['org.gnome.Shell.Extensions', 'ShellVersion']),
    );
    const shellVersion = version.deepUnpack?.() ?? version;
    if (!SUPPORTED_GNOME_MAJORS.includes(Number.parseInt(shellVersion, 10)))
      throw new Error(
        _('Animated wallpapers currently support GNOME 50 and 51 on Wayland.'),
      );
    const result = syncExtension({ install: true });
    this._shellId = result.shellId;
    this._shellChanged ||= result.shellChanged;
    const [enabled] = await call(
      'org.gnome.Shell.Extensions',
      '/org/gnome/Shell/Extensions',
      'org.gnome.Shell.Extensions',
      'EnableExtension',
      new GLib.Variant('(s)', [EXTENSION_UUID]),
    );
    if (!enabled) {
      // New extensions are discovered at Shell startup. Queue only our UUID.
      const settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
      const extensions = settings.get_strv('enabled-extensions');
      if (!extensions.includes(EXTENSION_UUID))
        settings.set_strv('enabled-extensions', [
          ...extensions,
          EXTENSION_UUID,
        ]);
      throw new LoginRequiredError(Boolean(this._shellChanged));
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      if ((await this.refresh()).available) {
        if (this.status.loginRequired) throw new LoginRequiredError(true);
        return;
      }
      await new Promise((resolve) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
          resolve();
          return GLib.SOURCE_REMOVE;
        }),
      );
    }
    throw new Error(
      _(
        'Enable Wallshader Live Wallpaper in GNOME Extensions, then try again.',
      ),
    );
  }

  async apply(preset, fps = 30, rendering = 'compatibility') {
    await this.initialize();
    if (!(await this.refresh()).available) await this.setUp();
    const config = normalizeLiveConfig({
      preset,
      fps,
      rendering,
      enabled: true,
      paused: false,
    });
    await call(
      'org.gnome.Shell',
      LIVE_PATH,
      LIVE_INTERFACE,
      'Apply',
      new GLib.Variant('(s)', [JSON.stringify(config)]),
    );
    return this.refresh();
  }

  async stop() {
    // Also clear the persisted choice when the extension is disabled or locked.
    const { readJson, writeJson } = await import('./storage.js');
    const path = GLib.build_filenamev([
      GLib.get_user_config_dir(),
      'wallshader',
      'live-wallpaper.json',
    ]);
    const saved = readJson(path);
    if (saved) writeJson(path, { ...saved, enabled: false });
    if ((await this.refresh()).available)
      await call('org.gnome.Shell', LIVE_PATH, LIVE_INTERFACE, 'Stop');
    return this.refresh();
  }

  async pause(paused) {
    await call(
      'org.gnome.Shell',
      LIVE_PATH,
      LIVE_INTERFACE,
      'SetPaused',
      new GLib.Variant('(b)', [paused]),
    );
    return this.refresh();
  }

  close() {
    Gio.DBus.session.signal_unsubscribe(this._subscription);
  }
}

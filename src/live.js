import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ROOT } from './paths.js';
import {
  EXTENSION_UUID,
  LIVE_INTERFACE,
  LIVE_PATH,
  normalizeLiveConfig,
} from './live-config.js';

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

function copyDirectory(source, destination) {
  destination.make_directory_with_parents(null);
  const children = source.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );
  try {
    for (
      let child = children.next_file(null);
      child;
      child = children.next_file(null)
    ) {
      const input = source.get_child(child.get_name());
      const output = destination.get_child(child.get_name());
      if (child.get_file_type() === Gio.FileType.DIRECTORY)
        copyDirectory(input, output);
      else if (child.get_file_type() === Gio.FileType.REGULAR)
        input.copy(output, Gio.FileCopyFlags.NONE, null, null);
      else
        throw new Error(
          'The extension bundle contains an unsupported file. Rebuild Wallshader.',
        );
    }
  } finally {
    children.close(null);
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
        this.status = JSON.parse(parameters.deepUnpack()[0]);
        this._onChange(this.status);
      },
    );
  }

  async refresh() {
    try {
      const [source] = await call(
        'org.gnome.Shell',
        LIVE_PATH,
        LIVE_INTERFACE,
        'GetStatus',
      );
      this.status = JSON.parse(source);
    } catch {
      this.status = { available: false, active: false };
    }
    this._onChange(this.status);
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
    if (!shellVersion.startsWith('50.'))
      throw new Error(
        'Animated wallpapers currently support GNOME 50 on Wayland.',
      );
    const directory = Gio.File.new_for_path(
      GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'gnome-shell',
        'extensions',
      ]),
    );
    const destination = directory.get_child(EXTENSION_UUID);
    if (!destination.query_exists(null)) {
      const bundle = [
        GLib.build_filenamev([ROOT, 'build', 'extension']),
        GLib.build_filenamev([ROOT, 'extension']),
      ]
        .map((path) => Gio.File.new_for_path(path))
        .find((file) => file.get_child('app').query_exists(null));
      if (!bundle)
        throw new Error(
          'Build Wallshader with “bun run build” to include animated wallpaper support.',
        );
      const staging = directory.get_child(
        `.wallshader-${GLib.uuid_string_random()}`,
      );
      copyDirectory(bundle, staging);
      staging.move(destination, Gio.FileCopyFlags.NONE, null, null);
    }
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
      throw new Error(
        'Animation support is installed. Log out and back in once, then choose “Set Animated Wallpaper”.',
      );
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      if ((await this.refresh()).available) return;
      await new Promise((resolve) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
          resolve();
          return GLib.SOURCE_REMOVE;
        }),
      );
    }
    throw new Error(
      'Enable Wallshader Live Wallpaper in GNOME Extensions, then try again.',
    );
  }

  async apply(preset, fps = 30) {
    if (!(await this.refresh()).available) await this.setUp();
    const config = normalizeLiveConfig({
      preset,
      fps,
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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import { CONFIG_DIR, DATA_DIR } from './paths.js';
import { readJson, writeJson } from './storage.js';

Gio._promisify(
  Gio.File.prototype,
  'replace_contents_bytes_async',
  'replace_contents_finish',
);

export function pngBytes(dataUri) {
  if (
    typeof dataUri !== 'string' ||
    !dataUri.startsWith('data:image/png;base64,')
  )
    throw new Error('The renderer did not return a PNG image.');
  const bytes = GLib.base64_decode(
    dataUri.slice('data:image/png;base64,'.length),
  );
  // Decode before saving or updating settings, so a bad renderer response cannot become a wallpaper.
  Gdk.Texture.new_from_bytes(new GLib.Bytes(bytes));
  return bytes;
}

export async function savePng(file, dataUri) {
  await file.replace_contents_bytes_async(
    new GLib.Bytes(pngBytes(dataUri)),
    null,
    false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  );
}

export class Wallpaper {
  constructor() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(
      'org.gnome.desktop.background',
      true,
    );
    this.settings = schema
      ? new Gio.Settings({ settings_schema: schema })
      : null;
    this.backupPath = GLib.build_filenamev([
      CONFIG_DIR,
      'previous-wallpaper.json',
    ]);
  }

  get canRestore() {
    return Gio.File.new_for_path(this.backupPath).query_exists(null);
  }

  _check() {
    if (!this.settings)
      throw new Error(
        'GNOME wallpaper settings are unavailable. You can still export a PNG.',
      );
    for (const key of ['picture-uri', 'picture-uri-dark', 'picture-options']) {
      if (!this.settings.is_writable(key))
        throw new Error(
          'Your desktop wallpaper is managed by an administrator. You can still export a PNG.',
        );
    }
  }

  _set(values) {
    this.settings.delay();
    for (const [key, value] of Object.entries(values)) {
      if (!this.settings.set_string(key, value)) {
        this.settings.revert();
        throw new Error('GNOME could not update the wallpaper.');
      }
    }
    this.settings.apply();
  }

  async apply(dataUri, presetId) {
    this._check();
    const directory = GLib.build_filenamev([DATA_DIR, 'wallpapers']);
    GLib.mkdir_with_parents(directory, 0o700);
    const safeId = presetId.replace(/[^a-z0-9-]/g, '');
    const file = Gio.File.new_for_path(
      GLib.build_filenamev([
        directory,
        `${safeId}-${GLib.uuid_string_random()}.png`,
      ]),
    );
    await savePng(file, dataUri);
    if (!this.canRestore)
      writeJson(
        this.backupPath,
        Object.fromEntries(
          ['picture-uri', 'picture-uri-dark', 'picture-options'].map((key) => [
            key,
            this.settings.get_string(key),
          ]),
        ),
      );
    this._set({
      'picture-uri': file.get_uri(),
      'picture-uri-dark': file.get_uri(),
      'picture-options': 'zoom',
    });
    return file;
  }

  restore() {
    this._check();
    const backup = readJson(this.backupPath);
    if (
      !backup ||
      !['picture-uri', 'picture-uri-dark', 'picture-options'].every(
        (key) => typeof backup[key] === 'string',
      )
    )
      throw new Error('No valid previous wallpaper was found.');
    this._set(
      Object.fromEntries(
        ['picture-uri', 'picture-uri-dark', 'picture-options'].map((key) => [
          key,
          backup[key],
        ]),
      ),
    );
    Gio.File.new_for_path(this.backupPath).delete(null);
  }
}

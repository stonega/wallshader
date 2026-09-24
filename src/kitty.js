import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { DATA_DIR, ROOT } from './paths.js';
import { savePng } from './wallpaper.js';
import {
  hasKittyBackground,
  kittyBackgroundConfig,
  removeKittyBackground,
} from './kitty-config.js';

function readConfig(file) {
  try {
    const [, bytes, etag] = file.load_contents(null);
    return {
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      etag,
    };
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      return { source: '', etag: null };
    throw error;
  }
}

function writeText(file, source, etag = null) {
  // Follow symlinks (e.g. dotfile managers), and reject concurrent edits via the etag.
  if (source)
    file.replace_contents(
      new TextEncoder().encode(source),
      etag,
      false,
      Gio.FileCreateFlags.PRIVATE,
      null,
    );
  // GJS marshals an empty Uint8Array as NULL; closing a replacement stream
  // without writes atomically restores an empty config instead.
  else file.replace(etag, false, Gio.FileCreateFlags.PRIVATE, null).close(null);
}

function writeStream(stream, source) {
  try {
    if (source) stream.write_all(new TextEncoder().encode(source), null);
  } finally {
    stream.close(null);
  }
}

function writeConfig(file, source, etag) {
  if (etag !== null) return writeText(file, source, etag);
  // Exclusive creation prevents overwriting a config created during PNG capture.
  writeStream(file.create(Gio.FileCreateFlags.PRIVATE, null), source);
}

export class KittyBackground {
  constructor() {
    let directory =
      GLib.getenv('KITTY_CONFIG_DIRECTORY') ||
      GLib.build_filenamev([GLib.get_user_config_dir(), 'kitty']);
    if (directory.startsWith('~/'))
      directory = GLib.build_filenamev([
        GLib.get_home_dir(),
        directory.slice(2),
      ]);
    directory = GLib.canonicalize_filename(directory, GLib.get_current_dir());
    this.config = Gio.File.new_for_path(
      GLib.build_filenamev([directory, 'kitty.conf']),
    );
  }

  get canRestore() {
    try {
      return hasKittyBackground(readConfig(this.config).source);
    } catch {
      return false;
    }
  }

  async checkAnimationSupport() {
    const binary = GLib.find_program_in_path('kitty');
    if (!binary)
      throw new Error(
        'Install Kitty 0.49 or newer to use animated backgrounds.',
      );
    const process = Gio.Subprocess.new(
      [binary, '--version'],
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
      process.force_exit();
      return GLib.SOURCE_REMOVE;
    });
    let output;
    try {
      output = await new Promise((resolve, reject) =>
        process.communicate_utf8_async(null, null, (subprocess, result) => {
          try {
            resolve(subprocess.communicate_utf8_finish(result)[1]);
          } catch (error) {
            reject(error);
          }
        }),
      );
    } finally {
      if (GLib.MainContext.default().find_source_by_id(timeout))
        GLib.source_remove(timeout);
    }
    const version = /kitty (\d+)\.(\d+)\./.exec(output);
    if (
      !process.get_successful() ||
      !version ||
      (Number(version[1]) === 0 && Number(version[2]) < 49)
    )
      throw new Error(
        'Animated backgrounds require Kitty 0.49 or newer. Choose Still image for older versions.',
      );
  }

  async apply(dataUri, shader = null) {
    const { source, etag } = readConfig(this.config);
    // Validate markers before creating any assets.
    removeKittyBackground(source);
    const directory = Gio.File.new_for_path(
      GLib.build_filenamev([DATA_DIR, 'kitty', GLib.uuid_string_random()]),
    );
    directory.make_directory_with_parents(null);
    const image = directory.get_child('background.png');
    const pipeline = directory.get_child('wallshader.pipeline');
    const slang = directory.get_child('wallshader.slang');
    const notices = ['LICENSE', 'NOTICE'].map((name) =>
      directory.get_child(name),
    );
    const textures = (shader?.textures ?? []).map((_source, index) =>
      directory.get_child(`wallshader-texture-${index}.slang`),
    );
    try {
      await savePng(image, dataUri);
      if (shader) {
        for (const file of notices)
          Gio.File.new_for_path(
            GLib.build_filenamev([
              ROOT,
              'data',
              'third-party',
              `Paper-Shaders-${file.get_basename()}`,
            ]),
          ).copy(file, Gio.FileCopyFlags.NONE, null, null);
        for (const [index, file] of textures.entries())
          writeText(file, shader.textures[index]);
        writeText(slang, shader.source);
        writeText(pipeline, shader.pipeline);
      }
      const updated = kittyBackgroundConfig(
        source,
        image.get_path(),
        shader ? pipeline.get_path() : null,
      );
      GLib.mkdir_with_parents(this.config.get_parent().get_path(), 0o700);
      writeConfig(this.config, updated, etag);
    } catch (error) {
      for (const file of [
        image,
        pipeline,
        slang,
        ...textures,
        ...notices,
        directory,
      ]) {
        try {
          file.delete(null);
        } catch {
          /* Best effort cleanup of this attempt only. */
        }
      }
      throw error;
    }
  }

  restore() {
    const { source, etag } = readConfig(this.config);
    if (!hasKittyBackground(source))
      throw new Error('No Wallshader Kitty background was found.');
    writeText(this.config, removeKittyBackground(source), etag);
  }
}

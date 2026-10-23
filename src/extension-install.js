import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { _ } from './i18n.js';
import { ROOT } from './paths.js';
import { EXTENSION_UUID } from './live-config.js';

export function extensionDirectory() {
  const hostData = GLib.getenv('HOST_XDG_DATA_HOME');
  const data =
    hostData && GLib.path_is_absolute(hostData)
      ? hostData
      : GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share']);
  return Gio.File.new_for_path(
    GLib.build_filenamev([data, 'gnome-shell', 'extensions', EXTENSION_UUID]),
  );
}

function fileType(file) {
  try {
    return file
      .query_info(
        'standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
      )
      .get_file_type();
  } catch (error) {
    if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) return null;
    throw error;
  }
}
function directory(file) {
  if (fileType(file) === null) file.make_directory_with_parents(null);
  if (fileType(file) !== Gio.FileType.DIRECTORY)
    throw new Error(
      _('The animation extension folder must be a regular directory.'),
    );
}
function replace(file, bytes, etag = null) {
  return new Promise((resolve, reject) =>
    file.replace_contents_bytes_async(
      new GLib.Bytes(bytes),
      etag,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
      (source, result) => {
        try {
          resolve(source.replace_contents_finish(result)[1]);
        } catch (error) {
          reject(error);
        }
      },
    ),
  );
}

// The manifest grants this one extension directory, never its parent or siblings.
// Replace files atomically and keep the previous bytes for rollback on failure.
export async function installBundledExtension() {
  const resource = Gio.Resource.load(`${ROOT}/wallshader-extension.gresource`);
  Gio.resources_register(resource);
  const changes = [];
  try {
    const source = Gio.File.new_for_uri(
      'resource:///io/github/wallshader/extension',
    );
    const [, metadata] = source.get_child('metadata.json').load_contents(null);
    if (JSON.parse(new TextDecoder().decode(metadata)).uuid !== EXTENSION_UUID)
      throw new Error(
        _('The animation extension bundle is invalid. Reinstall Wallshader.'),
      );
    const destination = extensionDirectory();
    async function copyFile(input, output) {
      const type = fileType(output);
      if (type !== null && type !== Gio.FileType.REGULAR)
        throw new Error(
          _('The animation extension contains an unsupported file.'),
        );
      const previous = type === null ? null : output.load_contents(null);
      const [, contents] = input.load_contents(null);
      const etag = await replace(output, contents, previous?.[2] ?? null);
      changes.push({ output, previous, etag });
    }
    async function copyTree(input, output) {
      directory(output);
      const children = input.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      try {
        for (
          let child = children.next_file(null);
          child;
          child = children.next_file(null)
        ) {
          const name = child.get_name();
          // Commit root metadata last, after the complete payload is present.
          if (input.equal(source) && name === 'metadata.json') continue;
          if (child.get_file_type() === Gio.FileType.DIRECTORY)
            await copyTree(input.get_child(name), output.get_child(name));
          else await copyFile(input.get_child(name), output.get_child(name));
        }
      } finally {
        children.close(null);
      }
    }
    await copyTree(source, destination);
    await copyFile(
      source.get_child('metadata.json'),
      destination.get_child('metadata.json'),
    );
  } catch (error) {
    for (const { output, previous, etag } of changes.reverse()) {
      try {
        if (previous) await replace(output, previous[1], etag);
        else output.delete(null);
      } catch (rollback) {
        console.warn(`Extension rollback: ${rollback.message}`);
      }
    }
    throw error;
  } finally {
    Gio.resources_unregister(resource);
  }
}

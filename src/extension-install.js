import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { _, format } from './i18n.js';
import { ROOT } from './paths.js';
import { EXTENSION_UUID } from './live-config.js';

const nofollow = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;

function children(directory) {
  const iterator = directory.enumerate_children(
    'standard::name,standard::type',
    nofollow,
    null,
  );
  const result = [];
  try {
    for (
      let child = iterator.next_file(null);
      child;
      child = iterator.next_file(null)
    )
      result.push(child);
  } finally {
    iterator.close(null);
  }
  return result;
}

function inventory(directory, prefix = '') {
  if (directory.query_file_type(nofollow, null) !== Gio.FileType.DIRECTORY)
    return null;
  const result = [];
  for (const child of children(directory)) {
    const name = child.get_name();
    const path = `${prefix}${name}`;
    const file = directory.get_child(name);
    const type = child.get_file_type();
    if (type === Gio.FileType.DIRECTORY) {
      result.push([path, 'directory'], ...inventory(file, `${path}/`));
    } else if (type === Gio.FileType.REGULAR) {
      const [, data] = file.load_contents(null);
      result.push([
        path,
        'file',
        GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data),
      ]);
    } else result.push([path, 'unsupported']);
  }
  return result.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function copyDirectory(source, destination) {
  destination.make_directory_with_parents(null);
  for (const child of children(source)) {
    const input = source.get_child(child.get_name());
    const output = destination.get_child(child.get_name());
    if (child.get_file_type() === Gio.FileType.DIRECTORY)
      copyDirectory(input, output);
    else input.copy(output, Gio.FileCopyFlags.NONE, null, null);
  }
}

function remove(file) {
  if (file.query_file_type(nofollow, null) === Gio.FileType.DIRECTORY)
    for (const child of children(file))
      remove(file.get_child(child.get_name()));
  file.delete(null);
}

function metadata(directory) {
  if (directory.query_file_type(nofollow, null) !== Gio.FileType.DIRECTORY)
    return null;
  const file = directory.get_child('metadata.json');
  if (file.query_file_type(nofollow, null) !== Gio.FileType.REGULAR)
    return null;
  const [, data] = file.load_contents(null);
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}

function bundledExtension() {
  return ['build/extension', 'extension']
    .map((path) => Gio.File.new_for_path(`${ROOT}/${path}`))
    .find((file) => file.get_child('app').query_exists(null));
}

function bundleInfo(bundle) {
  const info = bundle && metadata(bundle);
  if (
    info?.uuid !== EXTENSION_UUID ||
    !/^[a-f0-9]{64}$/.test(info?.['wallshader-shell-id'] ?? '') ||
    !bundle.get_child('build-info.js').query_exists(null) ||
    !bundle.get_child('app/src/desktop-renderer.js').query_exists(null) ||
    !bundle.get_child('app/build/renderer/renderer.js').query_exists(null)
  )
    return null;
  return info;
}

// Startup refreshes only an existing installation. First installation remains
// an explicit animated-apply action; no Shell calls or settings writes happen here.
export function syncExtension({
  install = false,
  bundle = null,
  managedPath = GLib.getenv('WALLSHADER_MANAGED_EXTENSION'),
  destination = Gio.File.new_for_path(
    GLib.build_filenamev([
      GLib.get_user_data_dir(),
      'gnome-shell',
      'extensions',
      EXTENSION_UUID,
    ]),
  ),
} = {}) {
  const installed =
    destination.query_file_type(nofollow, null) !== Gio.FileType.UNKNOWN;
  if (managedPath) {
    const info = bundleInfo(Gio.File.new_for_path(managedPath));
    if (!info)
      throw new Error(
        _(
          'The packaged wallpaper extension is missing or damaged. Reinstall Wallshader.',
        ),
      );
    if (installed)
      throw new Error(
        // Translators: {path} is the user's existing extension directory.
        format(
          _(
            'A per-user Wallshader extension is hiding the packaged extension. Move “{path}” out of the extensions directory, then log out and back in.',
          ),
          { path: destination.get_path() },
        ),
      );
    return {
      updated: false,
      shellChanged: false,
      shellId: info['wallshader-shell-id'],
      managed: true,
    };
  }
  if (!installed && !install)
    return { updated: false, shellChanged: false, shellId: null };
  bundle ??= bundledExtension();
  const info = bundleInfo(bundle);
  const shellId = info?.['wallshader-shell-id'];
  if (!info)
    throw new Error(
      _(
        'Build Wallshader with “bun run build” to include animated wallpaper support.',
      ),
    );
  const files = inventory(bundle);
  if (!files || files.some(([, type]) => type === 'unsupported'))
    throw new Error(
      _(
        'The extension bundle contains an unsupported file. Rebuild Wallshader.',
      ),
    );
  if (
    installed &&
    JSON.stringify(files) === JSON.stringify(inventory(destination))
  )
    return { updated: false, shellChanged: false, shellId };

  const previousId = installed
    ? metadata(destination)?.['wallshader-shell-id']
    : null;
  const parent = destination.get_parent();
  const name = `.wallshader-${GLib.uuid_string_random()}`;
  const staging = parent.get_child(name);
  const backup = parent.get_child(`${name}.previous`);
  let backedUp = false;
  try {
    copyDirectory(bundle, staging);
    if (installed) {
      destination.move(backup, Gio.FileCopyFlags.NONE, null, null);
      backedUp = true;
    }
    try {
      staging.move(destination, Gio.FileCopyFlags.NONE, null, null);
    } catch (error) {
      if (backedUp)
        backup.move(destination, Gio.FileCopyFlags.NONE, null, null);
      throw error;
    }
  } finally {
    if (staging.query_exists(null)) remove(staging);
  }
  if (backedUp) remove(backup);
  return {
    updated: true,
    shellChanged: installed && previousId !== shellId,
    shellId,
  };
}

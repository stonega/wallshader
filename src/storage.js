import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { _, format } from './translation.js';
import { CONFIG_DIR } from './paths.js';
import { normalizeState } from './catalog.js';

export function readJson(path) {
  const file = Gio.File.new_for_path(path);
  try {
    const [, bytes] = file.load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      return null;
    throw error;
  }
}

export function writeJson(path, value) {
  GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
  Gio.File.new_for_path(path).replace_contents(
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
    null,
    false,
    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  );
}

// Watching the directory survives atomic replacement of state.json.
export function watchState(onChange) {
  const path = GLib.build_filenamev([CONFIG_DIR, 'state.json']);
  const refresh = () => {
    try {
      onChange(readJson(path) ?? {});
    } catch (error) {
      console.warn(`Could not read preferences: ${error.message}`);
    }
  };
  GLib.mkdir_with_parents(CONFIG_DIR, 0o700);
  const monitor = Gio.File.new_for_path(CONFIG_DIR).monitor_directory(
    Gio.FileMonitorFlags.NONE,
    null,
  );
  monitor.connect('changed', (_monitor, file, otherFile) => {
    if (file?.get_path() === path || otherFile?.get_path() === path) refresh();
  });
  refresh();
  return monitor;
}

export function watchDebugInfo(onChange) {
  return watchState((state) => onChange(state.debugInfo === true));
}

export class Store {
  constructor() {
    this.path = GLib.build_filenamev([CONFIG_DIR, 'state.json']);
    this.warning = null;
    try {
      this.state = normalizeState(readJson(this.path));
    } catch (error) {
      this.state = normalizeState();
      this.warning = format(_('Saved settings could not be read: {error}'), {
        error: error.message,
      });
    }
  }

  save() {
    writeJson(this.path, this.state);
  }
}

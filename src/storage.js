import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
export function watchDebugInfo(onChange) {
  const path = GLib.build_filenamev([CONFIG_DIR, 'state.json']);
  const refresh = () => {
    try {
      onChange(readJson(path)?.debugInfo === true);
    } catch (error) {
      console.warn(`Could not read debug preference: ${error.message}`);
    }
  };
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

export class Store {
  constructor() {
    this.path = GLib.build_filenamev([CONFIG_DIR, 'state.json']);
    this.warning = null;
    try {
      this.state = normalizeState(readJson(this.path));
    } catch (error) {
      this.state = normalizeState();
      this.warning = `Saved settings could not be read: ${error.message}`;
    }
  }

  save() {
    writeJson(this.path, this.state);
  }
}

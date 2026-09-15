import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const ROOT = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .get_parent()
  .get_path();
export const DATA_DIR = GLib.build_filenamev([
  GLib.get_user_data_dir(),
  'wallshader',
]);
export const CONFIG_DIR = GLib.build_filenamev([
  GLib.get_user_config_dir(),
  'wallshader',
]);
export const APP_ID = 'io.github.wallshader.Wallshader';

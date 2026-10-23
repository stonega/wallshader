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
export const IS_FLATPAK = GLib.file_test(
  '/.flatpak-info',
  GLib.FileTest.EXISTS,
);
export const APP_ID = IS_FLATPAK
  ? 'io.github.stonega.wallshader'
  : 'io.github.wallshader.Wallshader';

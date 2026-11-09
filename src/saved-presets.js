import { _ } from './i18n.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { DATA_DIR } from './paths.js';
import { normalizePreset } from './catalog.js';
import { pngBytes } from './wallpaper.js';
import { writeJson } from './storage.js';

export function savedPreviewFile(id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id))
    throw new Error(_('Invalid saved preset.'));
  return Gio.File.new_for_path(
    GLib.build_filenamev([DATA_DIR, 'presets', `${id}.png`]),
  );
}

export function saveNamedPreset(store, name, preset, preview, savedId = null) {
  const existing = savedId
    ? store.state.savedPresets.find((item) => item.id === savedId)
    : null;
  if (savedId && (!existing || existing.preset.shader !== preset.shader))
    throw new Error(_('Invalid saved preset.'));
  name = name.trim();
  if (!name || name.length > 80)
    throw new Error(_('Enter a name between 1 and 80 characters.'));
  if (
    store.state.savedPresets.some(
      (item) =>
        item.id !== savedId &&
        item.preset.shader === preset.shader &&
        item.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error(
      _(
        'A preset with this name already exists for this shader. Choose another name.',
      ),
    );
  const saved = {
    id: existing?.id ?? GLib.uuid_string_random(),
    name,
    preset: normalizePreset(preset.id, preset),
  };
  const bytes = pngBytes(preview);
  const file = savedPreviewFile(saved.id);
  GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
  const previousPreview =
    existing && file.query_exists(null) ? file.load_contents(null)[1] : null;
  const writePreview = (contents) =>
    file.replace_contents(
      contents,
      null,
      false,
      Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    );
  writePreview(bytes);
  try {
    const next = {
      ...store.state,
      savedPresets: existing
        ? store.state.savedPresets.map((item) =>
            item.id === savedId ? saved : item,
          )
        : [...store.state.savedPresets, saved],
    };
    writeJson(store.path, next);
    store.state = next;
  } catch (error) {
    try {
      if (previousPreview) writePreview(previousPreview);
      else file.delete(null);
    } catch (cleanupError) {
      console.warn(cleanupError.message);
    }
    throw error;
  }
  return saved;
}

export function deleteNamedPreset(store, id) {
  const saved = store.state.savedPresets.find((item) => item.id === id);
  if (!saved) return null;
  const file = savedPreviewFile(id);
  const next = {
    ...store.state,
    savedPresets: store.state.savedPresets.filter((item) => item.id !== id),
  };
  // Keep the entry and preview intact if persisting the deletion fails.
  writeJson(store.path, next);
  store.state = next;
  try {
    file.delete(null);
  } catch (error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      console.warn(`Could not remove saved preview: ${error.message}`);
  }
  return saved;
}

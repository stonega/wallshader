import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import { DATA_DIR } from './paths.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(
  GdkPixbuf.Pixbuf,
  'new_from_stream_at_scale_async',
  'new_from_stream_finish',
);

export async function importImage(file) {
  const info = file.query_info(
    'standard::size',
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  if (info.get_size() > 32 * 1024 * 1024)
    throw new Error('Choose an image smaller than 32 MB.');
  const stream = await file.read_async(GLib.PRIORITY_DEFAULT, null);
  let image;
  try {
    image = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
      stream,
      2048,
      2048,
      true,
      null,
    );
  } finally {
    stream.close(null);
  }
  const directory = GLib.build_filenamev([DATA_DIR, 'images']);
  GLib.mkdir_with_parents(directory, 0o700);
  const destination = Gio.File.new_for_path(
    GLib.build_filenamev([directory, `${GLib.uuid_string_random()}.png`]),
  );
  image.savev(destination.get_path(), 'png', [], []);
  return destination.get_uri();
}

const cache = new Map();
export async function rendererPreset(preset) {
  if (!preset.image?.startsWith('file:///')) return preset;
  if (!cache.has(preset.image)) {
    const file = Gio.File.new_for_uri(preset.image);
    const info = file.query_info(
      'standard::size',
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    if (info.get_size() > 32 * 1024 * 1024)
      throw new Error('The saved image is too large. Choose another image.');
    const [bytes] = await file.load_contents_async(null);
    const loader = new GdkPixbuf.PixbufLoader();
    loader.write(bytes);
    loader.close();
    const image = loader.get_pixbuf();
    const [, png] = image.save_to_bufferv('png', [], []);
    cache.set(preset.image, `data:image/png;base64,${GLib.base64_encode(png)}`);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  return { ...preset, imageData: cache.get(preset.image) };
}

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { WallshaderWindow } from 'file:///app/share/wallshader/src/window.js';
import { createPreset } from 'file:///app/share/wallshader/src/catalog.js';

const app = new Adw.Application({
  application_id: 'io.github.stonega.wallshader',
});
let window;
const ready = new Gio.SimpleAction({
  name: 'test-ready',
  state: new GLib.Variant('b', false),
});
const error = new Gio.SimpleAction({
  name: 'test-error',
  state: new GLib.Variant('s', ''),
});
app.add_action(ready);
app.add_action(error);
function action(name, type, callback) {
  const item = new Gio.SimpleAction({
    name,
    ...(type ? { parameter_type: new GLib.VariantType(type) } : {}),
  });
  item.connect('activate', (_item, value) => {
    Promise.resolve()
      .then(() => callback(value?.deepUnpack()))
      .catch((exception) =>
        error.set_state(new GLib.Variant('s', exception.message)),
      );
  });
  app.add_action(item);
}
action('restore', null, () => {});
action('quit', null, () => window.close());
action('test-apply', 's', async (source) => {
  const options = JSON.parse(source);
  window.preset = createPreset(options.preset ?? 'aurora');
  if (options.speed) window.preset.speed = options.speed;
  window.wallpaperMode.selected = 1;
  window.liveFps.selected = options.fps === 60 ? 1 : 0;
  window.store.state.liveRendering = options.rendering ?? 'compatibility';
  await window.applyAnimatedWallpaper();
});
action('test-pause', 'b', (paused) => window.live.pause(paused));
action('test-stop', null, () => window.live.stop());
action('test-setup', null, () => window.live.setUp());
app.connect('startup', () => {
  const provider = new Gtk.CssProvider();
  provider.load_from_path('/app/share/wallshader/data/style.css');
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
});
app.connect('activate', () => {
  if (window) {
    window.present();
    return;
  }
  window = new WallshaderWindow(app);
  window._dimensions = () => ({ width: 640, height: 400 });
  window.showError = (exception) =>
    error.set_state(new GLib.Variant('s', exception.message));
  window.present();
  window.ready
    .then(() => {
      // A normal sandbox window with a matching title must never be claimed.
      new Gtk.Window({
        application: app,
        title: 'Wallshader Desktop 0',
        default_width: 200,
        default_height: 100,
      }).present();
      ready.set_state(new GLib.Variant('b', true));
      console.log('Flatpak animation test editor ready');
    })
    .catch((exception) =>
      error.set_state(new GLib.Variant('s', exception.message)),
    );
  window.connect('close-request', () => {
    app.quit();
    return false;
  });
});
app.run([]);

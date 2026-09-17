import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cairo from 'cairo';
import System from 'system';
import { Preview } from './preview.js';
import { DebugInfo } from './debug-info.js';
import { readJson, watchDebugInfo } from './storage.js';
import { CONFIG_DIR, ROOT } from './paths.js';
import { RENDERER_ID, normalizeLiveConfig } from './live-config.js';

// Only the Shell extension launches this process, with an owned Wayland socket.
const monitors = JSON.parse(ARGV[0] ?? '[]');
if (
  !monitors.length ||
  monitors.some(
    (m) => !Number.isInteger(m.index) || m.width < 1 || m.height < 1,
  )
)
  throw new Error('The wallpaper renderer requires a monitor layout.');
const configPath = GLib.build_filenamev([CONFIG_DIR, 'live-wallpaper.json']);
let config = normalizeLiveConfig(readJson(configPath));
let paused = true;
let failed = false;
const previews = [];
let debugMonitor;
let debugInfo = false;
const app = new Gtk.Application({ application_id: RENDERER_ID });
const ready = new Gio.SimpleAction({
  name: 'ready',
  state: new GLib.Variant('b', false),
});
const diagnostic = new Gio.SimpleAction({
  name: 'diagnostics',
  state: new GLib.Variant('s', '{}'),
});
app.add_action(ready);
app.add_action(diagnostic);

function fail(error) {
  console.error(`Wallpaper renderer: ${error.message}`);
  failed = true;
  app.quit();
}

function setDebug(preview, enabled) {
  preview.debug.panel.set_visible(enabled);
  return preview.setDebug(enabled);
}

function action(name, type, callback) {
  const item = new Gio.SimpleAction({
    name,
    ...(type ? { parameter_type: new GLib.VariantType(type) } : {}),
  });
  item.connect('activate', (_action, value) => callback(value?.deepUnpack()));
  app.add_action(item);
}
action('quit', null, () => app.quit());
action('pause', 'b', (value) => {
  paused = value;
  for (const preview of previews) preview.pause(paused).catch(fail);
});
action('reload', null, () => {
  try {
    config = normalizeLiveConfig(readJson(configPath));
    Promise.all(
      previews.map(async (preview) => {
        await preview.request('live', { fps: config.fps });
        await preview.select(config.preset);
        await preview.pause(paused);
      }),
    ).catch(fail);
  } catch (error) {
    fail(error);
  }
});
action('inspect', null, () => {
  Promise.all(previews.map((preview) => preview.request('state')))
    .then((states) =>
      diagnostic.set_state(
        new GLib.Variant(
          's',
          JSON.stringify({
            paused,
            fps: config.fps,
            rendering: config.rendering,
            skiaCpuRendering: GLib.getenv('WEBKIT_SKIA_ENABLE_CPU_RENDERING'),
            frames: states.map((state) => state.frame),
            preset: config.preset.id,
            monitors: previews.length,
            debugInfo: previews.map((preview) => preview.debug.panel.visible),
            debugStats: previews.map((preview) => preview.debug.info ?? null),
            renderers: previews.map(
              (preview) =>
                preview.widget.get_native().get_renderer().constructor.$gtype
                  .name,
            ),
          }),
        ),
      ),
    )
    .catch(fail);
});

app.connect('activate', () => {
  if (previews.length) return;
  const provider = new Gtk.CssProvider();
  provider.load_from_path(GLib.build_filenamev([ROOT, 'data', 'style.css']));
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
  debugMonitor = watchDebugInfo((enabled) => {
    debugInfo = enabled;
    for (const preview of previews)
      setDebug(preview, enabled).catch((error) => console.warn(error.message));
  });
  const pending = monitors.map(async (monitor) => {
    const window = new Gtk.ApplicationWindow({
      application: app,
      title: `Wallshader Desktop ${monitor.index}`,
      decorated: false,
      resizable: true,
      default_width: monitor.width,
      default_height: monitor.height,
    });
    // GTK can clamp a default size to the work area (excluding the panel).
    // This surface is a desktop, so its minimum must cover the whole monitor.
    window.set_size_request(monitor.width, monitor.height);
    const preview = new Preview(fail, (info) => preview.debug.update(info));
    preview.debug = new DebugInfo(preview.widget);
    // Desktop surfaces extend behind GNOME's top bar. Keep the panel clear of it.
    preview.debug.panel.set_valign(Gtk.Align.END);
    previews.push(preview);
    preview.widget.set_can_target(false);
    preview.widget.set_focusable(false);
    window.set_child(preview.debug.widget);
    window.connect('realize', () =>
      window.get_surface().set_input_region(new Cairo.Region()),
    );
    window.present();
    await preview.ready;
    await preview.request('live', { fps: config.fps });
    await preview.select(config.preset);
    await preview.pause(paused);
    await setDebug(preview, debugInfo);
    console.log(
      `Desktop ${monitor.index}: ${window.get_renderer().constructor.$gtype.name}`,
    );
  });
  Promise.all(pending)
    .then(() => {
      console.log('Wallshader desktop renderer ready');
      ready.set_state(new GLib.Variant('b', true));
    })
    .catch(fail);
});
app.connect('shutdown', () => {
  debugMonitor?.cancel();
  for (const preview of previews) preview.close();
});
// A renderer must not survive a disabled/crashed Shell extension.
const shellWatch = Gio.bus_watch_name(
  Gio.BusType.SESSION,
  'org.gnome.Shell',
  Gio.BusNameWatcherFlags.NONE,
  () => {},
  () => app.quit(),
);
app.run([]);
Gio.bus_unwatch_name(shellWatch);
System.exit(failed ? 1 : 0);

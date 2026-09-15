import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { Preview } from '../src/preview.js';
import { PRESETS, createPreset } from '../src/catalog.js';

if (
  GLib.getenv('GSETTINGS_BACKEND') !== 'memory' ||
  !GLib.get_user_config_dir().includes('wallshader-render-probe.')
)
  throw new Error('Use scripts/diagnose-rendering.sh for an isolated preview.');

const mode = ARGV[0];
if (!['hardware', 'shared-memory'].includes(mode))
  throw new Error('Choose hardware or shared-memory frame transport.');
const shared = mode === 'shared-memory';
if (GLib.getenv('WEBKIT_DMABUF_RENDERER_FORCE_SHM') !== (shared ? '1' : '0'))
  throw new Error('The requested frame transport was not set before startup.');
const title = shared
  ? 'Wallshader B · Shared memory'
  : 'Wallshader A · GPU sharing';
const app = new Gtk.Application({
  application_id: 'io.github.wallshader.RenderProbe',
  flags: Gio.ApplicationFlags.NON_UNIQUE,
});
let preview;
let exitCode = 0;
app.connect('activate', () => {
  if (preview) return;
  const window = new Gtk.ApplicationWindow({
    application: app,
    title,
    default_width: 960,
    default_height: 680,
  });
  const header = new Gtk.HeaderBar({
    title_widget: new Gtk.Label({ label: title }),
  });
  window.set_titlebar(header);
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  const controls = new Gtk.Box({
    spacing: 12,
    margin_top: 12,
    margin_bottom: 12,
    margin_start: 12,
    margin_end: 12,
  });
  const shaders = Gtk.DropDown.new_from_strings(
    PRESETS.map((item) => item.name),
  );
  shaders.selected = PRESETS.findIndex((item) => item.id === 'paper-dithering');
  controls.append(shaders);
  const pause = new Gtk.ToggleButton({ label: 'Pause' });
  controls.append(pause);
  controls.append(
    new Gtk.Label({ label: 'Watch the animated preview for flicker.' }),
  );
  box.append(controls);
  const status = new Gtk.Label({ label: 'Starting WebGL…', margin_bottom: 8 });
  const fail = (error) => {
    exitCode = 1;
    status.label = error.message;
    console.error(error);
  };
  preview = new Preview(fail);
  preview.widget.set_hexpand(true);
  preview.widget.set_vexpand(true);
  box.append(preview.widget);
  box.append(status);
  window.set_child(box);
  const select = async () => {
    const preset = createPreset(PRESETS[shaders.selected].id);
    // Bright colors expose dark gaps without confusing them with shader content.
    if (preset.shader === 'dithering') {
      preset.params.colorBack = '#80FF80';
      preset.params.colorFront = '#FF80FF';
    }
    await preview.select(preset);
  };
  shaders.connect('notify::selected', () => select().catch(fail));
  pause.connect('toggled', () => preview.pause(pause.active).catch(fail));
  window.present();
  preview.ready
    .then(select)
    .then(async () => {
      const backend = window.get_renderer().constructor.$gtype.name;
      status.label = `${shared ? 'Shared memory' : 'GPU sharing'} · ${backend} · WebGL enabled`;
      console.log(`${title}: ${backend}; frame transport requested: ${mode}`);
      await preview.evaluate(`(() => {
        const gl = document.querySelector('#preview canvas').getContext('webgl2');
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        console.log('Render probe WebGL: ' + JSON.stringify({
          renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          attributes: gl.getContextAttributes(),
          contextLost: gl.isContextLost(),
        }));
      })()`);
    })
    .catch(fail);
});
app.connect('shutdown', () => preview?.close());
app.run([]);
System.exit(exitCode);

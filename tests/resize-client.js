import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

if (!GLib.get_user_config_dir().includes('wallshader-shell-test.'))
  throw new Error('Resize client requires the isolated Shell test session');

const app = new Gtk.Application({
  application_id: 'io.github.wallshader.ResizeTest',
});
function createWindow() {
  const window = new Gtk.ApplicationWindow({
    application: app,
    title: 'Wallshader Resize Test',
    default_width: 640,
    default_height: 480,
    decorated: false,
  });
  // Exercise texture uploads, clipping, and changing layouts as well as geometry.
  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
  });
  content.append(
    new Gtk.HeaderBar({
      title_widget: new Gtk.Label({ label: 'Resize test' }),
    }),
  );
  const flow = new Gtk.FlowBox({
    homogeneous: true,
    max_children_per_line: 6,
    selection_mode: Gtk.SelectionMode.NONE,
    row_spacing: 8,
    column_spacing: 8,
  });
  for (let i = 0; i < 72; i++) {
    const button = new Gtk.Button({
      icon_name: i % 2 ? 'preferences-system-symbolic' : 'folder-symbolic',
    });
    button.set_size_request(100, 80);
    flow.insert(button, -1);
  }
  content.append(new Gtk.ScrolledWindow({ child: flow, vexpand: true }));
  window.set_child(content);
  window.present();
}
app.connect('activate', () => {
  for (let index = 0; index < Number(ARGV[0] ?? 1); index++) createWindow();
});
app.run([]);

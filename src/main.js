import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { APP_ID, ROOT } from './paths.js';
import { WallshaderWindow } from './window.js';

const smoke = ARGV.includes('--smoke-test');
const app = new Adw.Application({
  application_id: smoke ? `${APP_ID}.Test` : APP_ID,
  flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
let exitCode = 0;
function action(name, callback, accelerators = []) {
  const item = new Gio.SimpleAction({ name });
  item.connect('activate', callback);
  app.add_action(item);
  app.set_accels_for_action(`app.${name}`, accelerators);
}

app.connect('startup', () => {
  const provider = new Gtk.CssProvider();
  provider.load_from_path(GLib.build_filenamev([ROOT, 'data', 'style.css']));
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
  Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(
    GLib.build_filenamev([ROOT, 'data', 'icons']),
  );
  action('quit', () => app.get_active_window()?.close(), ['<primary>q']);
  action(
    'search',
    () => app.get_active_window()?.searchButton.emit('clicked'),
    ['<primary>f'],
  );
  action('restore', () => app.get_active_window()?.restoreWallpaper());
  action('import-settings', () =>
    app.get_active_window()?.showSettings('import'),
  );
  action('copy-settings', () =>
    app.get_active_window()?.showSettings('settings'),
  );
  action('copy-code', () => app.get_active_window()?.showSettings('code'));
  action('about', () => {
    const about = new Adw.AboutDialog({
      application_name: 'Wallshader',
      application_icon: APP_ID,
      version: '0.1.9',
      developer_name: 'Wallshader contributors',
      comments:
        'A little color for your desktop. Native GNOME wallpapers made with Paper Shaders.',
      license_type: Gtk.License.GPL_3_0,
      website: 'https://github.com/stonega/wallshader',
      issue_url: 'https://github.com/stonega/wallshader/issues',
    });
    about.add_acknowledgement_section('Shaders', [
      'Paper Shaders by Lost Coast Labs, Inc. — Apache-2.0',
    ]);
    about.present(app.get_active_window());
  });
});

app.connect('activate', () => {
  const window = app.get_active_window() ?? new WallshaderWindow(app);
  window.present();
  if (smoke) {
    import('../tests/native-smoke.js')
      .then(({ run }) => run(window))
      .then(() => {
        console.log('Native smoke test passed.');
        window.close();
      })
      .catch((error) => {
        console.error(`${error.message}\n${error.stack ?? ''}`);
        exitCode = 1;
        window.close();
      });
  }
});

app.run(ARGV.filter((arg) => arg !== '--smoke-test'));
System.exit(exitCode);

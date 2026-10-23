import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { WallshaderWindow } from 'file:///app/share/wallshader/src/window.js';
import {
  APP_ID,
  CONFIG_DIR,
  DATA_DIR,
  IS_FLATPAK,
} from 'file:///app/share/wallshader/src/paths.js';
import { savePng } from 'file:///app/share/wallshader/src/wallpaper.js';
import { importImage } from 'file:///app/share/wallshader/src/images.js';
import { showPreferences } from 'file:///app/share/wallshader/src/preferences.js';
import {
  extensionDirectory,
  installBundledExtension,
} from 'file:///app/share/wallshader/src/extension-install.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const delay = (milliseconds) =>
  new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
function control(method, value = null) {
  const reply = Gio.DBus.session.call_sync(
    'org.freedesktop.portal.Desktop',
    '/org/freedesktop/portal/desktop',
    'io.github.stonega.wallshader.Test',
    method,
    value,
    null,
    Gio.DBusCallFlags.NONE,
    5000,
    null,
  );
  return method === 'GetState' ? JSON.parse(reply.deepUnpack()[0]) : null;
}
async function waitForRequest() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (control('GetState').pending) return;
    await delay(30);
  }
  throw new Error('Wallpaper portal did not receive a request');
}
async function screenshot(window, path) {
  const paintable = new Gtk.WidgetPaintable({ widget: window });
  for (let attempt = 0; attempt < 30; attempt++) {
    window.queue_draw();
    await delay(100);
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, window.get_width(), window.get_height());
    const node = snapshot.to_node();
    if (!node) continue;
    assert(
      window.get_renderer().render_texture(node, null).save_to_png(path),
      'Screenshot failed',
    );
    return;
  }
  throw new Error('Window snapshot was empty');
}
async function run(window) {
  await window.ready;
  assert(
    IS_FLATPAK && window.application.application_id === APP_ID,
    'Incorrect sandbox application ID',
  );
  assert(
    window.wallpaper.settings === null,
    'Sandbox must not use desktop GSettings',
  );
  assert(
    !window.wallpaper.canRestore,
    'Portal cannot restore a previous wallpaper',
  );
  assert(
    window.wallpaperMode.selected === 1 &&
      window.wallpaperMode.model.get_n_items() === 2,
    'Sandbox must offer animated and still wallpapers',
  );
  assert(window.wallpaperMode.sensitive, 'Wallpaper mode must be selectable');
  assert(
    Gio.File.new_for_path(
      '/app/share/wallshader/wallshader-extension.zip',
    ).query_exists(null),
    'Companion extension ZIP is missing',
  );
  let setupRequired = false;
  try {
    await window.live.setUp();
  } catch (error) {
    setupRequired = error.name === 'ExtensionRequiredError';
  }
  assert(setupRequired, 'Missing host extension must show setup instructions');
  const extension = extensionDirectory();
  assert(
    !extension.get_child('metadata.json').query_exists(null),
    'Opening the editor installed host code before consent',
  );
  // The setup dialog must install directly, without a file chooser or CLI.
  window._showExtensionSetup('Install animation support');
  await delay(200);
  const setup = window.get_visible_dialog();
  assert(setup?.has_response('install'), 'Setup has no in-app install action');
  setup.close();
  assert(
    !extension.get_child('metadata.json').query_exists(null),
    'Cancel installed host code',
  );
  let loginMessage = '';
  window._showLoginRequired = (message) => {
    loginMessage = message;
  };
  window._showExtensionSetup('Install animation support');
  await delay(300);
  const installDialog = window.get_visible_dialog();
  await screenshot(
    window,
    `${GLib.getenv('WALLSHADER_ARTIFACTS')}/flatpak-animation-setup.png`,
  );
  function findInstallButton(widget) {
    if (widget instanceof Gtk.Button && widget.label === 'Install Extension')
      return widget;
    for (
      let child = widget.get_first_child();
      child;
      child = child.get_next_sibling()
    ) {
      const button = findInstallButton(child);
      if (button) return button;
    }
    return null;
  }
  const installButton = findInstallButton(installDialog);
  assert(installButton, 'Install Extension button is missing');
  installButton.emit('clicked');
  for (let attempt = 0; attempt < 100 && !loginMessage; attempt++)
    await delay(50);
  assert(
    loginMessage.includes('Log out'),
    'First install must explain GNOME discovery at login',
  );
  const [, installedMetadata] = extension
    .get_child('metadata.json')
    .load_contents(null);
  assert(
    JSON.parse(new TextDecoder().decode(installedMetadata)).uuid ===
      'wallshader@wallshader.github.io',
    'In-app install wrote incorrect extension metadata',
  );
  assert(
    extension.get_child('app/build/renderer/renderer.js').query_exists(null),
    'In-app install omitted the renderer',
  );
  // A damaged update must fail and roll back files already replaced.
  const marker = extension.get_child('COPYING');
  GLib.file_set_contents(marker.get_path(), 'previous extension content');
  const blocked = extension.get_child('metadata.json');
  const [, oldMetadata] = blocked.load_contents(null);
  blocked.delete(null);
  blocked.make_directory(null);
  let rejectedInstall = false;
  try {
    await installBundledExtension();
  } catch {
    rejectedInstall = true;
  }
  assert(rejectedInstall, 'Invalid destination was accepted');
  const [, restored] = marker.load_contents(null);
  assert(
    new TextDecoder().decode(restored) === 'previous extension content',
    'Failed update did not restore previous files',
  );
  blocked.delete(null);
  GLib.file_set_contents(blocked.get_path(), oldMetadata);
  await installBundledExtension();
  const sibling = extension.get_parent().get_child('other-extension@local');
  assert(
    !sibling.get_child('guard').query_exists(null),
    'Sandbox can read another host extension',
  );
  try {
    sibling.make_directory(null);
    GLib.file_set_contents(
      sibling.get_child('unexpected').get_path(),
      'sandbox-only',
    );
  } catch {}
  window.wallpaperMode.selected = 0;
  assert(
    window.applyButton instanceof Gtk.Button,
    'Sandbox must not show a destination dropdown',
  );
  assert(
    window.store.state.wallpaperTarget === 'desktop',
    'Saved Kitty target must reset in sandbox',
  );
  window.wallpaperTargetAction.change_state(new GLib.Variant('s', 'kitty'));
  assert(
    window.store.state.wallpaperTarget === 'desktop',
    'Kitty target must be unavailable',
  );
  assert(
    !window.application.lookup_action('restore').enabled,
    'Restore action must be disabled',
  );
  await window.live.refresh();
  await window.live.stop();
  assert(!window.live.status.available, 'Sandbox must not contact Shell');
  const png = await window.preview.request('capture', {
    width: 320,
    height: 200,
  });
  GLib.mkdir_with_parents(DATA_DIR, 0o700);
  const exported = Gio.File.new_for_path(`${DATA_DIR}/export.png`);
  await savePng(exported, png);
  const texture = Gdk.Texture.new_from_file(exported);
  assert(
    texture.width === 320 && texture.height === 200,
    'PNG export dimensions differ',
  );
  const imported = await importImage(exported);
  assert(imported.startsWith('file:///'), 'Local image import failed');

  let completed = false;
  const applying = window.wallpaper
    .apply(png, 'flatpak-test', window)
    .then((file) => {
      completed = true;
      return file;
    });
  await waitForRequest();
  assert(!completed, 'Apply completed before portal approval');
  const request = control('GetState').calls[0];
  assert(
    request.parent.startsWith('wayland:'),
    'Portal must be parented to the app window',
  );
  assert(
    request.setOn === 'background' && request.preview,
    'Portal must request desktop confirmation only',
  );
  assert(
    JSON.stringify(request.signature) === '[137,80,78,71,13,10,26,10]',
    'Portal did not receive a PNG file descriptor',
  );
  control('Respond', new GLib.Variant('(u)', [0]));
  const applied = await applying;
  assert(applied.query_exists(null), 'Successful wallpaper file was lost');
  assert(
    !Gio.File.new_for_path(
      `${CONFIG_DIR}/previous-wallpaper.json`,
    ).query_exists(null),
    'Sandbox wrote a wallpaper settings backup',
  );
  for (const response of [1, 2]) {
    const rejected = window.wallpaper.apply(png, 'rejected', window).then(
      () => false,
      () => true,
    );
    await waitForRequest();
    control('Respond', new GLib.Variant('(u)', [response]));
    assert(
      await rejected,
      `Portal response ${response} was reported as success`,
    );
  }
  const files = applied
    .get_parent()
    .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
  const names = [];
  for (let info = files.next_file(null); info; info = files.next_file(null))
    names.push(info.get_name());
  files.close(null);
  assert(
    names.length === 1,
    `Rejected portal requests left files behind: ${names}`,
  );
  // Exercise the user-facing apply path as well, including the success toast
  // without an unsupported Undo action and saving only after approval.
  window._dimensions = () => ({ width: 320, height: 200 });
  const errors = [];
  window.showError = (error) => errors.push(error.message);
  const uiApply = window.applyWallpaper();
  await waitForRequest();
  assert(
    window.store.state.recent.length === 0,
    'Apply was recorded before approval',
  );
  control('Respond', new GLib.Variant('(u)', [0]));
  await uiApply;
  assert(errors.length === 0, `Apply failed: ${errors}`);
  assert(
    window.store.state.recent.length === 1,
    'Approved apply was not recorded',
  );
  const preferences = showPreferences(window);
  assert(
    !preferences.desktopMenuRow.visible,
    'Host extension preference must be hidden',
  );
  preferences.close();
  await delay(400);
  const artifacts = GLib.getenv('WALLSHADER_ARTIFACTS');
  await screenshot(window, `${artifacts}/flatpak-window.png`);
  window.wallpaperSettings.present(window);
  await delay(400);
  assert(
    window.wallpaperSettings.get_mapped(),
    'Wallpaper settings did not open',
  );
  await screenshot(window, `${artifacts}/flatpak-settings.png`);
  window.wallpaperSettings.close();
  console.log(
    'Flatpak smoke test passed: in-app extension installation, cancellation, rollback, scoped permissions, preview, export, import, portal approval/cancellation/failure.',
  );
}

GLib.mkdir_with_parents(CONFIG_DIR, 0o700);
GLib.file_set_contents(
  `${CONFIG_DIR}/state.json`,
  JSON.stringify({ wallpaperTarget: 'kitty' }),
);
let exitCode = 0;
const app = new Adw.Application({ application_id: APP_ID });
app.connect('startup', () => {
  const restore = new Gio.SimpleAction({ name: 'restore' });
  app.add_action(restore);
  const provider = new Gtk.CssProvider();
  provider.load_from_path('/app/share/wallshader/data/style.css');
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
  Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(
    '/app/share/wallshader/data/icons',
  );
});
app.connect('activate', () => {
  const window = new WallshaderWindow(app);
  window.present();
  run(window)
    .catch((error) => {
      console.error(`${error.message}\n${error.stack}`);
      exitCode = 1;
    })
    .finally(() => {
      window.close();
      app.quit();
    });
});
app.run([]);
System.exit(exitCode);

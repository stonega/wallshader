import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { syncExtension } from '../src/extension-install.js';
import { LiveWallpaper, LoginRequiredError } from '../src/live.js';
import { LIVE_INTERFACE, LIVE_PATH } from '../src/live-config.js';

const options = JSON.parse(ARGV[0]);
if (options.managedPath)
  GLib.setenv('WALLSHADER_MANAGED_EXTENSION', options.managedPath, true);
if (options.controller) {
  const loop = new GLib.MainLoop(null, false);
  let runningId = '';
  const object = Gio.DBusExportedObject.wrapJSObject(
    `<node><interface name="${LIVE_INTERFACE}"><method name="GetStatus"><arg type="s" direction="out"/></method></interface></node>`,
    {
      GetStatus: () =>
        JSON.stringify({
          available: options.available !== false,
          active: options.available !== false,
          shellBuildId: runningId,
        }),
    },
  );
  object.export(Gio.DBus.session, LIVE_PATH);
  const owner = Gio.bus_own_name(
    Gio.BusType.SESSION,
    'org.gnome.Shell',
    Gio.BusNameOwnerFlags.NONE,
    null,
    async () => {
      try {
        const results = [];
        for (const id of options.runningIds ?? ['', '', options.shellId]) {
          runningId = id;
          const live = new LiveWallpaper();
          let loginRequired = false;
          let setupError = '';
          try {
            await live.initialize();
            if (options.setup) await live.setUp();
          } catch (error) {
            if (error instanceof LoginRequiredError && error.updated)
              loginRequired = true;
            else if (options.setup) setupError = error.message;
            else throw error;
          }
          results.push({
            loginRequired,
            status: live.status,
            ...(options.setup ? { setupError } : {}),
          });
          live.close();
        }
        print(JSON.stringify(results));
      } catch (error) {
        printerr(error.stack);
        System.exit(1);
      } finally {
        loop.quit();
      }
    },
    () => {
      printerr('Could not own the isolated Shell test name');
      System.exit(1);
    },
  );
  loop.run();
  Gio.bus_unown_name(owner);
  object.unexport();
} else {
  for (const key of ['bundle', 'destination'])
    if (options[key]) options[key] = Gio.File.new_for_path(options[key]);
  try {
    print(JSON.stringify(syncExtension(options)));
  } catch (error) {
    printerr(error.message);
    System.exit(1);
  }
}

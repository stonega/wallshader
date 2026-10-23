import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { syncExtension } from '../src/extension-install.js';
import { LiveWallpaper, LoginRequiredError } from '../src/live.js';
import { LIVE_INTERFACE, LIVE_PATH } from '../src/live-config.js';

const options = JSON.parse(ARGV[0]);
if (options.controller) {
  const loop = new GLib.MainLoop(null, false);
  let runningId = '';
  const object = Gio.DBusExportedObject.wrapJSObject(
    `<node><interface name="${LIVE_INTERFACE}"><method name="GetStatus"><arg type="s" direction="out"/></method></interface></node>`,
    {
      GetStatus: () =>
        JSON.stringify({
          available: true,
          active: true,
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
        for (const id of ['', '', options.shellId]) {
          runningId = id;
          const live = new LiveWallpaper();
          let loginRequired = false;
          try {
            await live.initialize();
          } catch (error) {
            if (!(error instanceof LoginRequiredError) || !error.updated)
              throw error;
            loginRequired = true;
          }
          results.push({ loginRequired, status: live.status });
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

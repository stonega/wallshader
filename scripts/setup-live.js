import GLib from 'gi://GLib';
import { LiveWallpaper } from '../src/live.js';

const loop = new GLib.MainLoop(null, false);
const live = new LiveWallpaper();
live
  .setUp()
  .then(() =>
    print(
      'Animated wallpaper support is ready. Choose Animated shader in Wallshader.',
    ),
  )
  .catch((error) => printerr(error.message))
  .finally(() => {
    live.close();
    loop.quit();
  });
loop.run();

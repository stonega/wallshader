import Gio from 'gi://Gio';
import Xdp from 'gi://Xdp?version=1.0';
import XdpGtk4 from 'gi://XdpGtk4?version=1.0';

Gio._promisify(Xdp.Portal.prototype, 'set_wallpaper', 'set_wallpaper_finish');

export async function setPortalWallpaper(file, window = null) {
  // libportal opens local files for SetWallpaperFile and tracks the asynchronous
  // Request response, including user cancellation, before reporting success.
  const portal = new Xdp.Portal();
  const parent = window ? XdpGtk4.parent_new_gtk(window) : null;
  await portal.set_wallpaper(
    parent,
    file.get_uri(),
    Xdp.WallpaperFlags.BACKGROUND | Xdp.WallpaperFlags.PREVIEW,
    null,
  );
}

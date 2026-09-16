# Wallshader

A native GNOME wallpaper app, written in **GJS, GTK 4, and libadwaita**, using
[Paper Shaders](https://github.com/paper-design/shaders).

Edit all **30 shaders and 124 Paper presets** from the pinned Paper library with
native controls. Choose from 36 gallery wallpapers, including nine original
palettes. Adjust shader parameters with sliders and exact numeric inputs, change
color counts and opacity, reorder colors, and control positioning and animation.
Image effects accept local images. Paste a component from Paper's **Code** section
to import its settings, or copy settings and Paper code from the app menu.

Apply a frame to GNOME's light and dark desktop backgrounds or export a
full-resolution PNG. Favorites and adjustments are saved. The app menu can restore
your previous wallpaper.

Choose **Still image** or **Animated shader** in the Wallpaper controls.
Animated wallpapers use a small GJS Shell extension on **GNOME 50 / Wayland** and
keep playing after the editor closes. They support every shader, multiple monitors,
30/60 FPS, pause/resume, and stop. Activities shows the animated shader in workspace
previews and thumbnails. Maximized windows and screen lock keep playback enabled;
only the Pause control pauses animation. The renderer stays running through lock
and unlock; GNOME's lock-screen background uses the captured still image.
Applying animation also sets its first frame as the static background for both
light and dark appearances. Stop reveals that still image; Restore Previous
Wallpaper returns to the background saved before the first apply.

On first use, **Set Animated Wallpaper** installs the bundled extension. A newly
installed extension requires one logout/login for GNOME to discover it. The app
explains this when needed. Still wallpapers and PNG export work without an extension.

## Install

Install from Fedora COPR below, or download a package from
[GitHub Releases](https://github.com/stonega/wallshader/releases).
Packages contain the app, renderer, icon, and live wallpaper extension. **Bun,
Meson, and a source checkout are not needed to run a packaged installation.**

Requires GJS 1.80+, GTK 4.14+, libadwaita 1.5+, WebKitGTK 2.44+ (6.0 API) with WebGL 2,
and a GNOME desktop for wallpaper integration. Animated wallpapers require
**GNOME 50 on Wayland**; still wallpapers and PNG export work on older desktops
that meet the app's runtime requirements.

### Fedora

Enable the [Wallshader COPR repository](https://copr.fedorainfracloud.org/coprs/stonegate/wallshader/)
and install on Fedora 43, 44, 45, or Rawhide (x86_64 and aarch64):

```sh
sudo dnf copr enable stonegate/wallshader
sudo dnf install wallshader
```

Updates arrive through `sudo dnf upgrade`.

Alternatively, download the `.noarch.rpm` asset from GitHub Releases and install
it from your download directory:

```sh
sudo dnf install ./wallshader-*.noarch.rpm
```

### Debian / Ubuntu

Use Debian 13, Ubuntu 24.04, or newer, with the required GNOME libraries. Download
the `_all.deb` asset and install it with APT so runtime dependencies are included:

```sh
sudo apt install ./wallshader_*_all.deb
```

Open **Wallshader** from the app grid or run `wallshader`. Installing the package
does not apply a wallpaper. The first **Set Animated Wallpaper** action installs
the bundled extension for your user; log out and back in when prompted.

Install a newer downloaded package with the same command to update the app.
Remove it with `sudo dnf remove wallshader` or `sudo apt remove wallshader`.

### Development packages and archives

Every successful main-branch, pull-request, and manual
[Build and Release workflow](https://github.com/stonega/wallshader/actions/workflows/build-and-release.yml)
run provides a `wallshader-packages` artifact. Sign in to GitHub, open the run,
and download it under **Artifacts**. These builds are also available before the
first tagged release. Extract the artifact ZIP, then install its RPM or DEB as above.

Each build includes `SHA256SUMS` and a `.tar.zst` archive of the prebuilt `/usr`
installation tree. To verify downloaded packages, place `SHA256SUMS` beside them:

```sh
sha256sum --ignore-missing --check SHA256SUMS
```

The archive is intended for manual installation and packaging; it does not
resolve runtime dependencies. See the [packaging guide](docs/implementation/setup.md#packages-and-releases).

## Build and install from source

Install [Bun](https://bun.sh/docs/installation) (CI uses 1.3.14), Git, and the
GNOME runtime and build tools for your distribution.

Fedora:

```sh
sudo dnf install git gjs gtk4 libadwaita webkitgtk6.0 gsettings-desktop-schemas meson ninja-build desktop-file-utils
```

Debian / Ubuntu:

```sh
sudo apt install git gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-webkit-6.0 gsettings-desktop-schemas meson ninja-build libgtk-4-bin desktop-file-utils
```

Clone the repository and install for the current user:

```sh
git clone https://github.com/stonega/wallshader.git
cd wallshader
./scripts/install.sh
```

The installer downloads the pinned shader dependency, builds the renderer and
extension, and installs the app, launcher, and icon under `~/.local`. Launch it
from the app grid or run `~/.local/bin/wallshader`.

To run directly from the checkout:

```sh
bun install --frozen-lockfile
bun run build
./scripts/run.sh
```

For a custom prefix, use `meson setup build-native --prefix=/your/prefix` and
`meson install -C build-native` after installing dependencies and building assets.
The application runs with GJS; runtime assets are entirely local.

## Verify

```sh
bun run check
bun test
bun run test:native
bun run test:shell
```

The native smoke test needs a graphical session. It renders all 36 gallery
wallpapers, checks editor controls, imports local images through Paper's three
logo processors, and verifies PNG content through 4K. It checks persistence and
wallpaper apply/restore with isolated settings. It never changes your desktop
background. Rendered test images and interface snapshots are saved in `artifacts/`.

The Shell integration test starts a separate headless GNOME 50 instance with two
virtual monitors, a private session bus, isolated XDG directories, and in-memory
settings. It verifies desktop placement, animation, pause, reverse playback,
updates, stop, and extension cleanup without changing the real desktop.

See [architecture](docs/design/architecture.md), [setup](docs/implementation/setup.md),
and [usage](docs/user/usage.md).

## Credits and license

Wallshader is GPL-3.0-or-later; see [COPYING](COPYING). The unmodified
`@paper-design/shaders` dependency is pinned to **0.0.80**, licensed Apache-2.0.
Its [LICENSE](data/third-party/Paper-Shaders-LICENSE) and
[NOTICE](data/third-party/Paper-Shaders-NOTICE) are preserved in the installation.
The upstream source was checked at `7002061d8389781a45e479584deeca0cf538474e`.

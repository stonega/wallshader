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

## Run

On Fedora:

```sh
sudo dnf install gjs gtk4 libadwaita webkitgtk6.0
bun install --frozen-lockfile
bun run build
./scripts/run.sh
```

On Debian/Ubuntu with sufficiently recent GNOME packages:

```sh
sudo apt install gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-webkit-6.0
```

Requires GJS 1.80+, GTK 4.14+, libadwaita 1.5+, WebKitGTK 6.0 with WebGL 2, and a
GNOME desktop for wallpaper integration. Bun only installs and bundles the shader
dependency; **the application runs with GJS**. Runtime assets are entirely local.

## Install

With Meson and Ninja installed:

```sh
./scripts/install.sh
```

This installs the app, desktop launcher, and icon under `~/.local`. For a custom
prefix, use `meson setup build-native --prefix=/your/prefix` and
`meson install -C build-native` after installing dependencies and building assets.

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

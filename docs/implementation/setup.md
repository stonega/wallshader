# Development setup

Use a GNOME graphical session with GJS 1.80+, GTK 4.14+, libadwaita 1.5+, and
WebKitGTK 6.0. Fedora's packages are `gjs gtk4 libadwaita webkitgtk6.0`.
Meson and Ninja are needed only for installation. Bun is required for build tools.

Run `bun install --frozen-lockfile`, `bun run build`, then `./scripts/run.sh`.
The build also packages the live wallpaper extension under `build/extension/`.
The launch script resolves the source directory independently of the working
directory. Rebuild after editing the catalog or browser renderer. GJS source
changes only require restarting the app.

`bun run check` uses Biome for JavaScript and JSON. Native GTK CSS is excluded from
the web CSS parser and checked by GTK during the native smoke test.
`bun test` exercises state validation, every upstream preset's parameter values,
settings/code round trips, search and capture limits. Frame-clock tests cover
30/60 fps pacing across display refresh rates, timestamp jitter and stalls.
`bun run test:native` uses actual GTK/WebKit rendering and GSettings with isolated
XDG directories and `GSETTINGS_BACKEND=memory`. Do not remove those safeguards.
It verifies that animated apply installs a matching first-frame PNG, preserves
the original wallpaper backup across reapply, and handles capture/save/startup
failures. The animated apply checks use a fake live controller so they cannot
start, pause, or stop wallpapers in the user's running Shell.
After gallery generation it samples 120 frames of the animated preview, checking
for missing/cleared regions and verifying that both shader time and visible pixels
change. `artifacts/preview-animation-failure.png` preserves the failing frame.
The native test also saves a named configuration through the preview dialog,
reloads its settings and PNG, selects Paper and saved grid tiles, and checks
cancellation, duplicate names, failed writes, and missing-thumbnail recovery.
Deletion checks cover saved-entry and thumbnail removal, failed-write preservation,
and keeping the editor configuration and desktop wallpaper unchanged.
Apply checks cover automatic saving for still and animated wallpapers, exact-frame
thumbnails, hex default names, duplicate prevention for built-in and saved presets,
and save failures after a successful apply. Logic tests cover generated-name
collisions within a shader.
`artifacts/save-preset-dialog.png` and `artifacts/preset-grid-{light,dark}.png`
show the dialog and thumbnail grid. Logic tests cover saved-state normalization,
immutable copies, selection matching, and image restoration across presets.

`bun run test:shell` needs GNOME Shell 50 with its headless Wayland backend. It
starts a separate Shell on a private D-Bus session, with private runtime, data,
config and cache directories, in-memory settings, and two virtual monitors.
Use `WALLSHADER_TEST_MONITORS=1 bun run test:shell` for the single-monitor case.
The primary monitor is 2560 × 1600. Coverage checks compare both window frames
and Wayland buffers to their full monitor bounds, including after late resizes,
moves, overview changes and renderer restarts.
Panel checks cover empty-workspace switches, recovery from a fullscreen wallpaper
state, and switching between an empty workspace and a regular fullscreen app.
Playback checks maximize a test window on each monitor and switch both displays
repeatedly between the covered workspace and an empty workspace. Playback must
remain enabled behind maximized windows, including across the periodic coverage
poll, and renderer diagnostics must show animation after switching. The compositor
hold must update before yielding to the main loop, preventing the periodic timer
from masking a missing workspace signal.
Switching must also preserve manual pause and reuse the existing renderer.
Lock checks enter and leave GNOME's `unlock-dialog` session mode in the private
Shell. The extension manager must keep the renderer and its windows alive with
playback enabled, and preserve manual pause across both transitions. These checks
exercise session-mode lifecycle, not lock-screen authentication or physical display
power management.
Visible wallpapers, including manually paused ones, must hold the compositor
inhibitor. Covered desktops, stop and disable must release it. Logic tests check
that repeated updates and renderer lifecycles balance the reference count without
releasing an inhibitor owned by another Shell component. Virtual displays cannot
exercise hardware direct scanout, so the physical-display top-bar behavior still
needs a manual check after installing and logging back in.
The wallpaper must keep full monitor coverage while the top bar remains visible;
regular fullscreen apps must still hide it.
It also continuously resizes and moves a separate Wayland application with a reflowing grid
of native controls over a bright Dithering wallpaper and samples 48 composited
frames for cleared/black regions, including
checking that paused pixels remain unchanged during both operations. This covers
the rendering path under window update load, but cannot rule out every driver-specific
or intermittent artifact on a physical display.
Overview checks cover live clones on both monitors, workspace thumbnails,
continued animation, manual pause, and cleanup after closing, stopping or disabling.
Its test-only session mode enables only the live wallpaper extension and its test
driver. `artifacts/shell-test.log` and desktop captures help diagnose failures.
The Shell test also switches between GPU and Compatibility, verifies the new
renderer process and its Skia environment, and checks that same-mode applies
reuse the process and that manual pause works in both modes. It verifies startup
and playback, not GPU performance or freedom from driver-specific GPU artifacts.
Native checks exercise the saved rendering selection and its apply payload;
`artifacts/wallpaper-settings{,-gpu}.png` show the dialog.
`GSK_RENDERER=gl bun run test:shell` and `GSK_RENDERER=vulkan bun run test:shell`
run the same checks with an explicit compositor and verify the selected backend
in the renderer's diagnostics. Without an override, GTK chooses its default.

Use `./scripts/install-extension.sh` to install animation support independently
of the editor or update an existing installation. It stages the complete bundle
and replaces the installed directory, restoring the previous directory if the
replacement fails. `--files-only` installs the bundle without contacting Shell
or changing enabled extensions; it is also exercised by an isolated installer
test. The app offers initial setup through its first animated apply. The
extension currently targets GNOME 50 on Wayland. After first installation, log out
and back in to let GNOME discover it. Updating an already loaded extension also
requires a fresh session; GNOME cannot reload imported JavaScript modules in place.
The live D-Bus status includes `compositing`, `panelVisible` and
`fullscreenMonitors` for diagnosing a disappearing top bar after that fresh login.
Changes confined to the bundled desktop renderer only require stopping and
reapplying the animation after updating its files. Its GJS and WebKit processes
load those files at startup.

Set `WALLSHADER_DEBUG=1` when launching to enable WebKit developer extras, or
`WALLSHADER_TRACE=1` to log renderer requests. If WebGL
cannot initialize, verify the graphics driver and WebKitGTK installation. No
sandbox-disabling flags are used. A failing preview disables capture actions.

### Comparing frame transport

For flicker that also affects the editor preview, run these in separate terminals:

```sh
./scripts/diagnose-rendering.sh hardware
./scripts/diagnose-rendering.sh shared-memory
```

These open independent A/B previews using the same `Preview` widget and Paper
renderer as the app. Both enable WebGL and use temporary settings and data. The
probe offers shader selection and pause; it has no wallpaper controls. Close each
window to remove its temporary profile. A bright Dithering preset makes dark gaps
easy to distinguish from shader content. Observe stationary playback as well as
window movement and resizing. The logs include the GTK backend and WebGL context
information (the engine may mask the GPU name).

If both independent previews work, `./scripts/diagnose-rendering.sh full-app`
opens the full editor with a copy of the saved presets and a fresh cache. This
mode also uses a private D-Bus session, so its live controls cannot reach the
user's running Shell. Edits stay in the temporary profile.

The B process sets `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` before WebKit starts.
WebKitGTK 2.52's shared-memory path reads composed GPU frames into memory before
handing them to GTK, instead of sharing DMA-BUF textures. WebGL remains enabled,
but the extra copy can cost CPU time and memory bandwidth. This is a diagnostic
comparison, not the application's default. The environment variable is internal
to WebKit; recheck its behavior when upgrading the engine.

Wallshader defaults to CPU rasterization for WebKit's Skia drawing backend while
keeping WebGL shaders and compositing accelerated. For an explicit comparison
with the original Skia GPU path, prefix a diagnostic command with
`WEBKIT_SKIA_ENABLE_CPU_RENDERING=0`. The native regression test reproduces the
triangle gaps with that override on the affected stack. Skia page rasterization
is separate from the shader's WebGL rendering backend.
For live wallpaper, choose **Wallpaper rendering → GPU (experimental)** and apply.
The extension explicitly sets the child's Skia variable from this saved choice,
overriding an inherited value; editor diagnostic overrides still work as above.
Switching modes restarts the renderer, since WebKit reads the variable at startup.
Install the updated extension and log out/in once to load this extension change.
Afterward, changing the rendering selection only needs another wallpaper apply.

The renderer is pinned to Paper 0.0.81. Before upgrading it, check the upstream
shader uniform definitions, ShaderMount API, licensing, and all native captures.
The build preserves the dependency's LICENSE and NOTICE in `data/third-party/`.
The 0.0.81 update includes Paper Texture's new controls and presets. Its legacy
settings conversion follows the upstream migration guide, with alpha-aware hex
mixing and unchanged RGB/HSL background colors for the new paper layer. Native
checks render every Paper Texture preset both procedurally and with the sample image.

To regenerate editor metadata, clone the upstream repo, check out
`43cd68db79fa0b1759f72ffc941b3238e2a3954c`, then run:

```sh
bun scripts/sync-paper.js /path/to/paper-shaders-checkout
bun run format
bun test
bun run test:native
```

The generator evaluates only static declarations from that trusted checkout. It
verifies the package version and reports parameters without documented ranges for
review. Generated metadata includes upstream presets and exact texture mipmap
requirements. Run it only against the pinned, reviewed upstream source.

Meson builds the renderer and installs native modules under `share/wallshader`,
with a launcher in `bin` and the desktop file and icon in their standard locations.
Bundled toolbar icons live under `share/wallshader/data/icons/hicolor`, matching
the app's module-relative icon search path. The supplied Save Preset SVG is
preserved in `data/icons/sources/`; conversion details are included in
`data/third-party/Save-Preset-Icon-NOTICE`.
It includes the extension bundle; run `bun run build` before Meson installation
after changes so this bundle is current.
The application has no runtime dependency on Bun or the source checkout after
installation.

## Packages and releases

The [Build and Release workflow](../../.github/workflows/build-and-release.yml)
checks the code, runs the logic tests, and builds three architecture-independent
assets on pushes to `main`, pull requests to `main`, and manual runs:

- `wallshader_VERSION_all.deb` for Debian/Ubuntu.
- `wallshader-VERSION-1.noarch.rpm` for Fedora.
- `wallshader-vVERSION.tar.zst` containing `wallshader-vVERSION/usr/`.

`SHA256SUMS` covers all three files. The `wallshader-packages` workflow artifact
contains the packages and checksums. A pushed `vMAJOR.MINOR.PATCH` tag also creates
a GitHub Release with the same assets and generated release notes. The release
job uses the repository's `GITHUB_TOKEN` with `contents: write`; builds and pull
requests have read-only repository permissions. No additional release secret is
needed.

Every release, including patch releases, must also be published to the existing
[Fedora COPR project](https://copr.fedorainfracloud.org/coprs/stonegate/wallshader/)
`stonegate/wallshader`. The GitHub workflow does not perform this step. After it
has published the release assets, use the configured COPR CLI credentials to
build an SRPM from the verified release archive with `data/wallshader-copr.spec`,
then submit it to all configured Fedora targets. Direct binary RPM uploads are
not enabled on this COPR instance. This requires `rpmbuild` and `copr-cli`:

```sh
release_tag=v0.1.3
release_version=${release_tag#v}
release_dir=$(mktemp -d /tmp/wallshader-release.XXXXXX)
gh release download "$release_tag" --repo stonega/wallshader --dir "$release_dir"
(cd "$release_dir" && sha256sum --check SHA256SUMS)
rpmbuild -bs --define "_topdir $release_dir/rpmbuild" \
  --define "_sourcedir $release_dir" data/wallshader-copr.spec
rpmbuild --rebuild --define "_topdir $release_dir/rebuild" \
  "$release_dir/rpmbuild/SRPMS/wallshader-$release_version-1.src.rpm"
copr-cli build --nowait stonegate/wallshader \
  "$release_dir/rpmbuild/SRPMS/wallshader-$release_version-1.src.rpm"
```

The spec packages the same installed application files as the GitHub release;
its `tar` and `zstd` build dependencies let COPR unpack the release archive.
The upload uses all configured targets unless explicitly restricted: Fedora 43,
44, 45, and Rawhide, each on x86_64 and aarch64. Use `copr-cli watch-build` with
the returned build ID to wait for publication. Confirm that every target succeeds
and its repository metadata contains the new version before declaring the release
complete. Existing COPR users then receive the update through `sudo dnf upgrade`.

Before tagging a release, set the same numeric version in `package.json`,
`meson.build`, `data/wallshader-copr.spec`, and the About dialog in `src/main.js`.
The package script rejects tags that do not match the package and Meson versions.
Commit the release changes,
then push the version tag, for example:

```sh
git tag v0.1.3
git push origin v0.1.3
```

To reproduce the packages locally, install the normal build tools plus
`dpkg-deb`, `rpmbuild`, `zstd`, and `desktop-file-validate`. On Debian/Ubuntu:

```sh
sudo apt install dpkg-dev rpm zstd desktop-file-utils
bun install --frozen-lockfile
bun run package
```

Pass an explicit tag with `bun run package v0.1.3` to perform the release-version
check. Outputs are written to `dist/`. The script rebuilds the renderer and
extension, stages Meson's `/usr` installation in a temporary `DESTDIR`, validates
the launcher and required assets, and packages that staging tree. It does not
install to the host or contact GNOME Shell. Only the selected application icon is
installed globally; toolbar icons remain in the app's private data directory.
Design sources and preview PNGs stay in the checkout. Both package
formats declare native runtime dependencies, and all formats retain Paper's
LICENSE and NOTICE. RPM relies on Fedora's file triggers for desktop/icon cache
updates; the DEB refreshes those caches when installed or removed.

For a manual archive installation, install the runtime dependencies listed in the
README first, then extract the chosen archive and copy its `usr/` contents into
`/usr/`. For version 0.1.3:

```sh
tar --zstd -xf wallshader-v0.1.3.tar.zst
sudo cp -a wallshader-v0.1.3/usr/. /usr/
sudo update-desktop-database /usr/share/applications
sudo gtk-update-icon-cache -f -t /usr/share/icons/hicolor
```

The archive's launcher targets `/usr/share/wallshader`; it is not relocatable.
Use Meson's custom-prefix source installation for another location. The RPM or
DEB is preferred for package-manager upgrades and removal.

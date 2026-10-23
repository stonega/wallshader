# Flatpak packaging

The repository builds a local Flatpak with application ID
`io.github.stonega.wallshader` and the GNOME 51 runtime. GJS, GTK, libadwaita,
WebKitGTK, and libportal come from that runtime. The manifest supports x86_64
and aarch64. GitHub Actions builds each architecture on a native runner and
includes both bundles in tagged GitHub Releases, with entries in `SHA256SUMS`.

## Build and install

Install Flatpak and flatpak-builder, then add Flathub for runtime dependencies:

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
./scripts/package-flatpak.sh
(cd dist/flatpak && sha256sum --check SHA256SUMS)
flatpak install --user dist/flatpak/wallshader.flatpak
flatpak run io.github.stonega.wallshader
```

`bun run package:flatpak` is an alias for the package script. Bun is not required
on the host: the build downloads a checksum-pinned build-only Bun 1.3.14 binary
for the selected architecture and removes it from the finished application.
Paper Shaders 0.0.81 is also downloaded and checksum-verified as a manifest source,
then extracted directly into `node_modules/@paper-design/shaders`. No package
manager or network access is needed inside the build sandbox. Paper's LICENSE
and NOTICE remain in the installed application. All translations remain bundled
so the language selector works without installing a separate locale extension.

The package script writes `build-flatpak/`, `.flatpak-builder/`, and
`dist/flatpak/`. The manifest's directory source excludes those paths and other
generated files. Extra flatpak-builder arguments can be passed to the script,
for example `./scripts/package-flatpak.sh --arch=aarch64` on an aarch64 host.
Cross-building requires a separately configured emulator.

## Sandbox behavior

### Animated desktop setup

Animation requires GNOME 50 or 51 on Wayland, Flatpak 1.18 or newer, and the
companion extension. Choose **Animated shader**, then **Set Animated Wallpaper**.
If animation support is missing, choose **Install Extension** in the app's setup
dialog. This installs the bundled extension into its own host folder and asks
GNOME to enable it. No terminal or manual ZIP installation is needed.

If GNOME has not discovered the extension yet, or its loaded code is older than
the bundled extension, the app explains that one logout/login is needed. After
logging back in, reopen Wallshader and apply again; the app enables its extension.
It never logs out or restarts Shell automatically. If the user has globally
disabled extensions, it asks them to turn extensions back on in GNOME Extensions
instead of overriding that preference.

The generated ZIP is still available for manual installation if preferred:

```sh
gnome-extensions install --force dist/flatpak/wallshader-extension.zip
```

After installing or updating, log out and back in. Enable **Wallshader Live
Wallpaper** in GNOME Extensions, or run:

```sh
gnome-extensions enable wallshader@wallshader.github.io
```

The ZIP and a GResource payload are embedded under `/app/share/wallshader/`.
The in-app installer reads the packaged resource without an external extraction
tool. It replaces files atomically, writes root metadata last and restores
previous file contents if a copy fails. It refuses symlink or other unexpected
destination types. The manifest grants only
`xdg-data/gnome-shell/extensions/wallshader@wallshader.github.io:create`, not the
parent directory or another extension's folder. No host command is executed.
Native GTK/WebKit packages and a native Wallshader installation are unnecessary
for Flatpak animation.

The first frame goes through the wallpaper portal for confirmation before
animation starts. Stop reveals that approved still image. The renderer remains
independent of the editor, supports 30/60 FPS, reverse playback, rendering-mode
changes, pause/resume, and resumes saved animation when the extension is enabled
at login. Images and preferences stay in the app's private Flatpak data.

The app previews and edits every shader, imports images through GTK's file
portal, saves presets, and exports PNG files. Still wallpapers are applied using
libportal's file-descriptor wallpaper request, parented to the app window. The
desktop asks for confirmation. The app records an apply as successful only after
the portal approves it; cancellation and failure remove the attempted image.
The request changes the desktop background, without requesting a lock-screen
change. Exact appearance handling is controlled by the desktop's portal backend.

The manifest grants Wayland, fallback X11/IPC, GPU rendering, and access to the
extension's `io.github.wallshader.Live` control service, GNOME's separate
`org.gnome.Shell.Extensions` manager, and its one host extension folder. The extension exports
this service on a separate D-Bus connection with only GetStatus, Apply, Stop,
and SetPaused. Its Apply method accepts only the Flatpak backend. It does not
expose Shell's interfaces or allow arbitrary host commands. Native clients retain
their existing interface for compatibility.

The extension starts the installed app with a fixed renderer command and
`--socket=inherit-wayland-socket` and `--die-with-parent`. Flatpak preserves
Mutter's private Wayland file descriptor, so `Meta.WaylandClient.owns_window` continues to identify
wallpaper windows. No title-only identification is used. The renderer owns an
application-ID-prefixed D-Bus name; normalized configuration is passed at launch
and through a typed action, without sharing host settings directories. Graceful
quit releases the old renderer before a mode change starts a replacement.
If Stop arrives before the app registers, shutdown waits for its quit action
with a termination timeout instead of immediately interrupting the supervisor's
fork. Native and Flatpak renderers can hand off without sharing a D-Bus name.
The sandbox also exits if its supervisor is terminated during startup or Shell
exits unexpectedly.

There is no network, home-directory, dconf, general GNOME Shell, or host-command
permission. GTK uses file portals for imports and exports. App data and settings
use Flatpak's private XDG directories, independently of the native installation.
Starting the editor never applies a wallpaper.

Previous-wallpaper restoration, the desktop-shortcut preference, and Kitty
configuration remain native-package features. The portal cannot read the previous
wallpaper, so the Flatpak edition does not offer Undo after applying a wallpaper.

## Verification

```sh
bun run check
bun test
./scripts/with-test-desktop.sh bun run test:native
./scripts/package-flatpak.sh
bun run test:flatpak
bun run test:flatpak:live
appstreamcli validate --no-net build-flatpak/files/share/metainfo/io.github.stonega.wallshader.metainfo.xml
```

The Flatpak test runs in an isolated headless GNOME desktop with private D-Bus,
runtime directory, displays, settings, and XDG directories. It installs the bundle
only into that temporary desktop's Flatpak user installation. Bubblewrap also
maps `~/.var/app` to a temporary directory for the entire private session, including
portal helper processes. It needs GNOME Shell's headless backend, host GJS,
Bubblewrap, the GNOME 51 runtime, and FUSE unmount tools.
A fake wallpaper portal checks the actual PNG file descriptor, exported Wayland
parent, confirmation options, delayed approval, cancellation, and failure. It
also checks shader startup, PNG export, local image import, and sandbox controls.
It verifies in-app installation, cancel without writing host code, logout
guidance, rollback after a failed update, repeat installation, and denial of
write access to another extension's directory.
It never applies a wallpaper through the user's portal. Screenshots and logs are
saved under `artifacts/flatpak-*`.

`test:flatpak:live` starts a separate two-monitor Shell and a real installed
Flatpak editor/renderer, with a private bus, displays, runtime directory,
installation, settings and `~/.var/app`. It checks socket ownership, rejects a
same-title normal window, checks both animation directions and 30/60 FPS,
visible changing pixels on each monitor, valid WebKit scaling, pause/resume,
rendering-mode and native/Flatpak handoffs, stop, editor independence, saved-backend
resume, early-start cancellation and disable cleanup. It also verifies that the
dedicated service exposes no Shell interfaces and rejects native-backend apply.
It also disables the installed extension and verifies that the sandboxed app
enables it again through GNOME's extension service.
The first-frame portal is mocked so no real wallpaper settings are changed.
Screenshots are saved as `flatpak-live-desktop.png` and `flatpak-live-overview.png`.

To run Flathub's technical linter locally, install `org.flatpak.Builder`, then:

```sh
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest packaging/flatpak/io.github.stonega.wallshader.json
flatpak run --command=flatpak-builder-lint org.flatpak.Builder builddir build-flatpak
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo dist/flatpak/repo
```

The in-app installer currently produces the review finding
`finish-args-unnecessary-xdg-data-gnome-shell-create-access`. The linter requests
review for host XDG subdirectories even when access is limited to one UUID.
This build has not received a Flathub exception. A human submitter must justify
the scoped extension-folder permission during review. See the linter's
[filesystem review checks](https://github.com/flathub/flatpak-builder-lint/blob/master/flatpak_builder_lint/checks/finish_args.py).
Do not suppress the finding or report unrestricted linter success. A future
alternative is GNOME's remote installation API after the companion extension
is independently published on extensions.gnome.org.

## Flathub submission status

Wallshader has not been submitted to Flathub by this implementation. The
repository manifest is for local builds and project CI; its directory source is
not suitable for a Flathub submission.

Flathub's current [generative AI policy](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy)
states: “Flathub manifests must not contain AI-generated or AI-assisted content.”
It also prohibits agents from opening or automating submission PRs, or generating
their commit messages, descriptions, comments, or replies. This local manifest
was AI-assisted and must not be copied into a Flathub submission, including after
human review. The application changes, packaging, tests, and documentation in
this Flatpak implementation were also AI-assisted; a submitter must disclose
affected material and its approximate extent. Reviewers decide whether disclosed
application material is acceptable.

A human maintainer must independently author a compliant Flathub manifest and
handle the submission and review interactions. Follow Flathub's current
[requirements](https://docs.flathub.org/docs/for-app-authors/requirements) and
[submission process](https://docs.flathub.org/docs/for-app-authors/submission).
Publish an upstream stable release containing the sandbox support first. Use an
immutable release source with a verified checksum rather than a directory source,
and include the architecture restriction file when the manifest supports only
x86_64 and aarch64. The submission branch targets `flathub/flathub`'s `new-pr`
branch. Do not claim the application is available on Flathub until its human
review, acceptance, and public publication have completed.

For future releases, update the metainfo release history and screenshot reference,
keep the runtime current, and update checksum-pinned Bun/Paper sources when their
reviewed versions change. Once accepted, the human-maintained Flathub repository
must receive each release update as well.

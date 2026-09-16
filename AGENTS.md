# Wallshader

Native GNOME wallpaper application written in GJS with GTK 4 and libadwaita.

## Structure

- `src/`: GJS application, GTK interface, persistence and GNOME wallpaper integration.
- `src/renderer/`: local canvas renderer using the upstream Paper Shaders package.
- `src/paper-catalog.js`: generated definitions for the full pinned Paper library.
- `src/editor.js`: native, metadata-driven shader editor. `src/sharing.js`: literal settings/code interchange.
- `extension/`: GNOME 50 Shell integration for animated desktop windows.
- `src/desktop-renderer.js`, `src/live.js`, `src/live-config.js`: independent renderer, app control, and shared protocol.
- `data/`: desktop integration, app icon, CSS, and third-party notices.
- `scripts/`: repeatable build, launch, installation and verification scripts.
- `tests/`: deterministic logic tests and native integration smoke tests.
- `docs/design/`, `docs/implementation/`, `docs/user/`: architecture, setup and usage.
- `examples/`: example saved presets. `postmortem/`: incident notes when needed.

## Conventions

Use GJS ES modules and native GTK/libadwaita widgets for application UI. WebKit is
only the local WebGL canvas renderer for Paper's original shaders. Do not introduce
React, Electron or a web application framework. Bun is a build/test tool, not the
application runtime. Pin Paper Shaders and preserve its LICENSE and NOTICE.
Regenerate Paper metadata with `scripts/sync-paper.js` against the reviewed,
matching upstream checkout. Keep shader parameters and upstream presets lossless.
Desktop windows must be identified with `Meta.WaylandClient.owns_window`, never
by title alone. Do not replace Shell methods or execute shader code inside Shell.

Read the relevant design and implementation docs before changes. Keep code small,
readable and consistent with existing modules. Update docs when behavior changes.
Use git for version control; use gh only when git is insufficient.

## Documentation and code discovery

Use Context7 resolve-library-id then query-docs for current library and API usage.
When a CodeGraph index exists, prefer its structural tools over grep for symbol,
caller, impact and architecture queries. Trust its results; do not delegate
exploration or repeat its source reads with grep. Native search is appropriate for
literal strings and files already open. Do not initialize CodeGraph without the
user's approval. Account for the index watcher's 500 ms write debounce.

## Verification

Run `bun run check` and `bun test` for relevant logic changes. Run
`bun run test:native` when changing GTK, WebKit or GNOME integration. The native
smoke test must isolate settings and data, and must not change the real wallpaper.
Never change the user's wallpaper as a side effect of startup or testing.
Use `bun run test:shell` for extension changes. It must keep its private D-Bus,
runtime directory, virtual displays and isolated settings; never exercise apply,
pause, or stop against the user's running Shell during verification.

## Commands

- `bun install --frozen-lockfile`: build dependencies
- `bun run build`: bundle the local shader renderer
- `./scripts/run.sh`: launch with GJS
- `bun run check`: Biome checks
- `bun test`: logic tests
- `bun run test:native`: native renderer and wallpaper integration smoke test
- `./scripts/install.sh`: install for the current user

## Releases

- Publish every release, including patch releases, to both GitHub Releases and
  the existing Fedora COPR project `stonegate/wallshader`. A GitHub tag alone
  does not complete a release.
- Follow the version bump and publishing steps in
  `docs/implementation/setup.md`. Keep the versions in `package.json`,
  `meson.build`, `src/main.js`, and `data/wallshader-copr.spec` aligned.
  After the GitHub release workflow succeeds, download its packages and
  `SHA256SUMS`, and verify the checksums.
- Build an SRPM from the verified release archive using
  `data/wallshader-copr.spec`, then submit it with
  `copr-cli build --nowait stonegate/wallshader /path/to/wallshader-VERSION-1.src.rpm`.
  Verify the SRPM rebuilds independently before submitting it. Direct binary RPM
  uploads are not enabled on this COPR instance. Use all configured COPR targets,
  currently Fedora 43, 44, 45, and Rawhide, on x86_64 and aarch64. Do not limit
  targets unless explicitly requested.
- Wait for COPR to succeed and verify that every target's repository metadata
  offers the released version before reporting publication complete.

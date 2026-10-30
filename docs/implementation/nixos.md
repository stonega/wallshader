# NixOS packaging

Wallshader is distributed for NixOS through this repository's GitHub flake.
It builds from source for `x86_64-linux` and `aarch64-linux`. `flake.lock` pins
Nixpkgs from the NixOS 26.05 branch. The app still requires a GNOME session;
animated wallpapers require GNOME 50 or 51 on Wayland and working WebGL 2
graphics support.

## Install from GitHub

Install the app and its matching extension into your user profile:

```sh
nix --extra-experimental-features 'nix-command flakes' \
  profile install github:stonega/wallshader#wallshader
```

Log out and back in once to make the desktop entry and extension visible to GNOME.
Then enable the extension and start the app from a terminal in your GNOME session,
as your normal user:

```sh
gnome-extensions enable wallshader@wallshader.github.io
wallshader
```

You can also enable **Wallshader Live Wallpaper** in GNOME Extensions and open
Wallshader from the app grid.

The declarative examples below install the package and enable the extension
automatically. Applying a wallpaper remains an explicit action in the app.
No source archive or manual installation of build tools is needed. In GNOME
Boxes, turn on **3D Acceleration** in the VM's preferences when available, then
restart the guest. For animation, `gnome-shell --version` should report 50 or 51
and `echo "$XDG_SESSION_TYPE"` should report `wayland`.

## Build locally

Enable Nix's `nix-command` and `flakes` experimental features, then run from a
checkout with all packaging files tracked by Git:

```sh
nix build
./result/bin/wallshader
nix build .#checks.x86_64-linux.installed
```

The `installed` check loads GTK 4, libadwaita and WebKit 6.0 through the installed
renderer wrapper and checks the GNOME background schema without opening a display
or modifying settings. It is available for both supported architectures.

Running a build result directly is useful for the editor, PNG export and still
wallpapers. Install the package into a desktop profile for GNOME to discover its
desktop entry and extension; a bare `nix run` does not register the extension.

## NixOS configuration

Add the repository to your existing system flake. This example installs Wallshader
and enables its GNOME extension through dconf:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  inputs.wallshader.url = "github:stonega/wallshader";

  outputs = { nixpkgs, wallshader, ... }: {
    nixosConfigurations.desktop = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        ({ pkgs, ... }:
        let
          package = wallshader.packages.${pkgs.stdenv.hostPlatform.system}.wallshader;
        in {
          environment.systemPackages = [ package ];
          programs.dconf.enable = true;
          programs.dconf.profiles.user.databases = [
            {
              settings."org/gnome/shell".enabled-extensions = [
                package.extensionUuid
                # Keep your other enabled extension UUIDs here too.
              ];
              locks = [ "/org/gnome/shell/enabled-extensions" ];
            }
          ];
        })
      ];
    };
  };
}
```

This fragment belongs in an existing GNOME configuration. It does not enable a
desktop environment. Keep the consumer's flake lock committed. The default uses
Wallshader's pinned dependency set; overriding its Nixpkgs input requires retesting
the resulting GNOME and WebKit versions.

Rebuild using your actual NixOS configuration name, then log out and back in once:

```sh
sudo nixos-rebuild switch --flake .#desktop
```

The dconf declaration manages the entire enabled-extension list. Preserve your
other UUIDs in it. The lock makes the declared list take precedence over existing
per-user settings, so change this list through Nix instead of GNOME Extensions.
Omit the lock if you prefer a system default that users can override; an existing
user value can then take precedence and leave Wallshader disabled.

## Home Manager

With the Wallshader flake input passed to your Home Manager module as `wallshader`:

```nix
{ pkgs, wallshader, ... }:
let
  package = wallshader.packages.${pkgs.stdenv.hostPlatform.system}.wallshader;
in
{
  home.packages = [ package ];
  dconf.enable = true;
  dconf.settings."org/gnome/shell".enabled-extensions = [
    package.extensionUuid
    # Keep your other extension UUIDs here too.
  ];
}
```

Pass the input through `home-manager.extraSpecialArgs = { inherit wallshader; };`
when Home Manager is a NixOS module, or through `extraSpecialArgs` when creating a
standalone `homeManagerConfiguration`. After activation, log out and back in so
GNOME discovers the extension. Applying animation remains an explicit app action.

## Migration, upgrades and rollback

An older installation under
`$XDG_DATA_HOME/gnome-shell/extensions/wallshader@wallshader.github.io`
(normally `~/.local/share/gnome-shell/extensions/`) shadows the packaged extension.
Wallshader reports this conflict and preserves both installations. Stop playback,
move the old directory completely outside `gnome-shell/extensions`, and log out
and back in. A renamed directory inside `extensions` can still be discovered by
its metadata UUID. Existing presets and settings remain under their XDG paths.

Update the Wallshader input in your consuming flake, rebuild your system or Home
Manager profile, and log out/in when the app reports older loaded Shell code.
Rolling back a generation follows the same rule: the running Shell can retain
newer JavaScript until a fresh session. The packaged build identifier detects both
directions. Installation and editor startup do not enable extensions or apply a
wallpaper. The editor never writes into the Nix store or creates a per-user copy.

## Package structure

`nix/package.nix` uses the existing Bun and Meson build. It reads the application
and Paper versions from `package.json`, fetches Paper's npm tarball with a fixed
SHA-256 hash, and unpacks it into `node_modules` before building. Paper currently
has no transitive dependencies. No `bun install` or network access is needed during
the application build. Bun is a build tool and is absent from the runtime closure.
The existing build retains Paper's LICENSE and NOTICE.
The Nix build applies `nix/patches/paper-liquid-metal-frame.patch` to Paper
0.0.81 and records the change in its installed NOTICE. Liquid Metal's imported
image path calls `smoothstep` with equal edges, whose result is
[undefined by GLSL](https://github.com/KhronosGroup/OpenGL-Refpages/blob/main/gl4/smoothstep.xml).
The patch defines the intended zero-width image boundary with `step`; positive
frame widths, uniforms, presets and metadata remain unchanged. The VM's imported
logo capture exercises this path. Review and remove the patch when upstream
provides the corresponding fix.

The editor and the GJS launcher under `libexec/wallshader-gjs` receive independent
`wrapGAppsHook4` environments with typelibs, schemas and GTK resources. The extension
uses that absolute launcher path, which is included in its Shell build identifier.
It still starts the child through `Meta.WaylandClient`; window ownership checks
remain unchanged. The editor wrapper sets `WALLSHADER_MANAGED_EXTENSION` to the
packaged bundle. Other distribution packages retain per-user installation behavior.
The renderer wrapper is an independent runtime dependency, with a convenience
symlink under `libexec`. Its hashed path therefore stays stable when Nix rewrites
the application's output path during a reproducibility check.

The standard `share/gnome-shell/extensions/<uuid>` entry points to the bundle under
`share/wallshader/extension`. Both come from the same derivation. The package
exports `extensionUuid` for declarative configuration and `meta.mainProgram` for
`nix run`.

## Verification

```sh
bun run check
bun test
./scripts/test-native-isolated.sh
bun run test:shell
nix fmt -- --check flake.nix nix/package.nix nix/integration.nix
nix flake check --no-build --all-systems
nix build .#checks.x86_64-linux.installed
nix build .#checks.aarch64-linux.installed
nix build --offline --rebuild --no-link .#wallshader
nix build --print-build-logs .#checks.x86_64-linux.integration
```

Build each architecture on a matching native runner or a configured builder.
`.github/workflows/nix.yml` builds both architectures and runs the installed
package's native and Shell suites in an x86_64 NixOS VM. The VM is separate from
the active desktop. Its native test fixtures include the sample logo and a captured
PNG for local-image and portable-settings checks. Its tests also create private
D-Bus sessions, XDG/runtime directories, displays and in-memory settings.
Screenshots and logs are copied
into the VM test output's `artifacts` directory. ARM graphical verification is
separate from the ARM package/runtime check.
The workflow also uploads these screenshots and logs as `nixos-integration`,
including artifacts copied before a failed assertion.

`scripts/test-shell.sh` accepts `WALLSHADER_TEST_PACKAGE_DIR=/nix/store/...-wallshader-...`
to test the installed bundle, desktop entry and renderer launcher. It stages the
extension as a system extension in its private data directory, leaving the
per-user extension directory empty. `scripts/test-native-isolated.sh` starts a
private virtual GNOME desktop before running `bun run test:native`; it also
accepts an explicit test command for the NixOS VM.

## Dependency updates

Update Nixpkgs with `nix flake update nixpkgs`, review the lock diff, and rerun
formatting, evaluation, both native builds and the VM integration test. Changing
Paper first follows [the upstream update procedure](update-paper-shaders.md).
Then update the tarball hash in `nix/package.nix`, verify it against the integrity
record in `bun.lock`, and repeat the package checks. If Paper gains transitive
dependencies, fetch and hash those explicitly or adopt a lockfile-based dependency
fetcher before building.
Recheck the Liquid Metal compatibility patch whenever changing Paper; a successful
patch application alone does not establish that it is still needed or correct.

References: [Nixpkgs GNOME packaging](https://nixos.org/manual/nixpkgs/stable/#sec-language-gnome),
[NixOS GNOME extensions](https://wiki.nixos.org/wiki/GNOME#Extensions).

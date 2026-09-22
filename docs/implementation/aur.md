# Arch Linux / AUR

`packaging/aur/PKGBUILD` builds the stable `wallshader` package from a checksummed
GitHub source tag. The recipe and generated `.SRCINFO` are kept in this repository;
publishing requires a separate push to the AUR Git repository. The recipe is ready
for initial submission, but this alone does not create an AUR listing.

Bun bundles the renderer and extension at build time; the installed application
runs with GJS. The package is architecture-independent (`arch=('any')`). Runtime
dependencies use Arch package names. GNOME Shell is optional for export and still
images; animated wallpapers require GNOME 50 on Wayland.

## Build and verify on Arch

Install `base-devel`, `git`, and `namcap`, then run from the Wallshader checkout:

```sh
cd packaging/aur
makepkg --syncdeps --cleanbuild
namcap PKGBUILD wallshader-*.pkg.tar.zst
makepkg --printsrcinfo > .SRCINFO
```

Run `makepkg` as a regular user. It resolves build and runtime dependencies using
pacman. `prepare()` downloads the locked dependencies into a cache under `src/`
with dependency lifecycle scripts disabled. `build()` builds both renderers and
the extension, and `check()` runs the logic tests and desktop-file validation.
Meson stages the installation under `pkg/`; package creation never launches the
app, connects to Shell, or changes wallpaper settings. Arch's package hooks handle
desktop and icon cache updates. Paper's LICENSE and NOTICE remain bundled.

Before submission, also build in a clean Arch environment (for example, use
`extra-x86_64-build` from `devtools`, or a fresh Arch container with only
`base-devel` and the declared dependencies). Inspect the package for the launcher,
native modules, renderer, extension bundle, desktop file, icons, and licenses.
The package must contain neither `node_modules` nor Bun itself. Installing for a
manual graphical test is separate from package creation:

```sh
sudo pacman -U ./wallshader-*.pkg.tar.zst
```

## First publication

Check the official repositories and AUR for an existing package before submitting.
Create an account at <https://aur.archlinux.org>, register a dedicated SSH public
key in the account settings, and configure SSH to use its private key for
`aur.archlinux.org`. Keep the private key outside both repositories.

After testing the recipe, run these commands from the Wallshader checkout:

```sh
aur_checkout=$(mktemp -d /tmp/wallshader-aur.XXXXXX)
git -c init.defaultBranch=master clone \
  ssh://aur@aur.archlinux.org/wallshader.git "$aur_checkout"
cp packaging/aur/PKGBUILD packaging/aur/.SRCINFO packaging/aur/LICENSE \
  "$aur_checkout/"
cd "$aur_checkout"
git add PKGBUILD .SRCINFO LICENSE
git commit -m 'Package Wallshader 0.1.6'
git push origin master
```

The AUR accepts the `master` branch. Use the desired public Git author identity
before committing. Upload only the recipe, metadata, packaging license, and any
necessary source patches; do not upload build outputs or source archives. These
packaging files use 0BSD; the application retains GPL-3.0-or-later and Paper retains
Apache-2.0.

Verify the listing and version at <https://aur.archlinux.org/packages/wallshader>
and build once from a fresh clone of the published AUR repository. Only then
advertise installation through an AUR helper, for example `yay -S wallshader`.
Pacman does not fetch AUR recipes directly.

## Release updates

For every release after initial publication:

1. Complete the GitHub and Fedora COPR release steps in [setup](setup.md#packages-and-releases).
2. Set `pkgver` in `packaging/aur/PKGBUILD` to the published version and reset
   `pkgrel` to `1`. For packaging-only fixes, keep `pkgver` and increment `pkgrel`.
3. Download the new source tag, review changes to build requirements and licenses,
   and update the source SHA-256 (for example with `updpkgsums` from
   `pacman-contrib`). This checksum covers the source archive, not the prebuilt
   release archive listed in `SHA256SUMS`.
4. Build and test in a clean Arch environment, then regenerate `.SRCINFO` with
   `makepkg --printsrcinfo > .SRCINFO`. Commit both files to this project.
5. Pull the AUR checkout, copy the updated recipe and metadata, commit, and push
   to `master`. Verify that the public listing offers the released version.

The GitHub release workflow does not push to AUR. Keep AUR publication as an
explicit release step until authenticated automation is configured.

References: [AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines),
[Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines),
and [Meson package guidelines](https://wiki.archlinux.org/title/Meson_package_guidelines).

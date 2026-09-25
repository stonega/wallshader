#!/usr/bin/env bash
set -euo pipefail

app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$app_dir"

if (( $# > 1 )); then
  printf 'Usage: %s [vMAJOR.MINOR.PATCH]\n' "$0" >&2
  exit 1
fi
for tool in bun meson ninja gjs python3 desktop-file-validate dpkg-deb rpmbuild zstd; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing package build tool: %s\n' "$tool" >&2
    exit 1
  fi
done

project_version=$(bun -p 'require("./package.json").version')
tag=${1:-v$project_version}
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Package tags must use vMAJOR.MINOR.PATCH: %s\n' "$tag" >&2
  exit 1
fi
version=${tag#v}
if [[ "$version" != "$project_version" ]]; then
  printf 'Tag version %s does not match package.json (%s).\n' "$version" "$project_version" >&2
  exit 1
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/wallshader-package.XXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT
install_root="$work_dir/wallshader-$tag"
package_root="$work_dir/deb"
rpm_topdir="$work_dir/rpmbuild"
assets_dir="$work_dir/assets"
app_id=io.github.wallshader.Wallshader
mkdir -p "$install_root" "$assets_dir"

# Always rebuild the renderer and its self-contained Shell extension together.
bun run build
meson setup "$work_dir/build" --prefix=/usr --buildtype=release
meson_version=$(meson introspect --projectinfo "$work_dir/build" | python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])')
if [[ "$version" != "$meson_version" ]]; then
  printf 'Tag version %s does not match meson.build (%s).\n' "$version" "$meson_version" >&2
  exit 1
fi
meson compile -C "$work_dir/build"
meson install -C "$work_dir/build" --destdir "$install_root" --no-rebuild

# Staging uses DESTDIR: package creation never installs or enables the extension.
desktop-file-validate "$install_root/usr/share/applications/$app_id.desktop"
test -x "$install_root/usr/bin/wallshader"
for file in \
  src/main.js \
  build/renderer/renderer.js \
  build/renderer/index.html \
  extension/extension.js \
  extension/metadata.json \
  extension/app/src/desktop-renderer.js \
  extension/app/build/renderer/renderer.js \
  data/third-party/Paper-Shaders-LICENSE \
  data/third-party/Paper-Shaders-NOTICE \
  data/third-party/Save-Preset-Icon-NOTICE \
  data/third-party/Kitty-Icon-NOTICE \
  data/icons/hicolor/scalable/actions/wallshader-save-preset-symbolic.svg \
  data/icons/hicolor/scalable/actions/wallshader-kitty.svg \
  COPYING; do
  if [[ ! -s "$install_root/usr/share/wallshader/$file" ]]; then
    printf 'Missing installed runtime asset: %s\n' "$file" >&2
    exit 1
  fi
done
cmp "data/icons/hicolor/scalable/apps/$app_id.svg" \
  "$install_root/usr/share/icons/hicolor/scalable/apps/$app_id.svg"

tar --sort=name --owner=0 --group=0 --numeric-owner --zstd \
  -C "$work_dir" -cf "$assets_dir/wallshader-$tag.tar.zst" "wallshader-$tag"

mkdir -p "$package_root/DEBIAN"
cp -a "$install_root/usr" "$package_root/"
install -Dm644 COPYING "$package_root/usr/share/doc/wallshader/copyright"
cat > "$package_root/DEBIAN/control" <<CONTROL
Package: wallshader
Version: $version
Section: graphics
Priority: optional
Architecture: all
Maintainer: Wallshader contributors <noreply@github.com>
Depends: gjs (>= 1.80), gir1.2-gtk-4.0 (>= 4.14), gir1.2-adw-1 (>= 1.5), gir1.2-gdkpixbuf-2.0, gir1.2-webkit-6.0 (>= 2.44), gsettings-desktop-schemas, hicolor-icon-theme, librsvg2-common
Homepage: https://github.com/stonega/wallshader
Description: Native GNOME wallpapers made with Paper Shaders
 Edit shader wallpapers, export PNG images, and apply still backgrounds.
 Animated wallpapers use the bundled extension on GNOME 50 with Wayland.
CONTROL
cat > "$package_root/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
POSTINST
cp "$package_root/DEBIAN/postinst" "$package_root/DEBIAN/postrm"
chmod 755 "$package_root/DEBIAN/postinst" "$package_root/DEBIAN/postrm"
dpkg-deb -Zzstd -z19 --root-owner-group --build \
  "$package_root" "$assets_dir/wallshader_${version}_all.deb"

mkdir -p "$rpm_topdir"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS,TMP}
tar --sort=name --owner=0 --group=0 --numeric-owner --zstd \
  -C "$install_root" -cf "$rpm_topdir/SOURCES/wallshader-$version.tar.zst" usr
cat > "$rpm_topdir/SPECS/wallshader.spec" <<SPEC
Name: wallshader
Version: $version
Release: 1
Summary: Native GNOME wallpapers made with Paper Shaders
License: GPL-3.0-or-later AND Apache-2.0
URL: https://github.com/stonega/wallshader
Source0: wallshader-$version.tar.zst
BuildArch: noarch

Requires: gjs >= 1.80
Requires: gtk4 >= 4.14
Requires: libadwaita >= 1.5
Requires: gdk-pixbuf2
Requires: webkitgtk6.0 >= 2.44
Requires: gsettings-desktop-schemas
Requires: hicolor-icon-theme
Requires: librsvg2

%description
Edit shader wallpapers, export PNG images, and apply still backgrounds.
Animated wallpapers use the bundled extension on GNOME 50 with Wayland.

%prep
%setup -q -c -T
tar --zstd -xf %{SOURCE0}

%build

%install
mkdir -p %{buildroot}
cp -a usr %{buildroot}/

# Fedora's file triggers refresh desktop metadata and the icon cache.
%files
%{_bindir}/wallshader
%{_datadir}/applications/$app_id.desktop
%{_datadir}/icons/hicolor/scalable/apps/$app_id.svg
%{_datadir}/wallshader
SPEC
rpmbuild -bb \
  --define "_topdir $rpm_topdir" \
  --define "_tmppath $rpm_topdir/TMP" \
  --define '_binary_payload w19.zstdio' \
  "$rpm_topdir/SPECS/wallshader.spec"
cp "$rpm_topdir/RPMS/noarch/wallshader-$version-1.noarch.rpm" "$assets_dir/"

(
  cd "$assets_dir"
  sha256sum ./*.deb ./*.rpm ./*.tar.zst > SHA256SUMS
)
mkdir -p "$app_dir/dist"
cp "$assets_dir/"* "$app_dir/dist/"
printf '\nPackages and SHA256SUMS saved to %s/dist\n' "$app_dir"

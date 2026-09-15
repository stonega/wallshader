#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$app_dir"
bun install --frozen-lockfile
bun run build
if [ -f build-native/build.ninja ]; then
  meson setup --reconfigure build-native --prefix="$HOME/.local"
else
  meson setup build-native --prefix="$HOME/.local"
fi
meson install -C build-native
printf 'Installed Wallshader. Launch it from the GNOME app grid or run %s/.local/bin/wallshader\n' "$HOME"

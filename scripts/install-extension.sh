#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
case "${1:-}" in
  ''|--files-only) ;;
  *) echo 'Usage: install-extension.sh [--files-only]' >&2; exit 1 ;;
esac
cd "$app_dir"
bun run build
extensions_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
destination="$extensions_dir/wallshader@wallshader.github.io"
mkdir -p "$extensions_dir"
staging=$(mktemp -d "$extensions_dir/.wallshader-install.XXXXXX")
backup="$staging.previous"
cleanup() {
  if [ -e "$backup" ] && [ ! -e "$destination" ]; then
    mv -- "$backup" "$destination"
  fi
  rm -rf -- "$staging"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp -R build/extension/. "$staging/"
if [ -e "$destination" ] || [ -L "$destination" ]; then
  mv -- "$destination" "$backup"
fi
mv -- "$staging" "$destination"
rm -rf -- "$backup"
echo 'Installed current Wallshader extension files. Log out and back in to load updated Shell code.'
if [ "${1:-}" = --files-only ]; then
  exit 0
fi
exec gjs -m scripts/setup-live.js

#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -f "$app_dir/build/renderer/renderer.js" ]; then
  cd "$app_dir"
  bun run build
fi
exec gjs -m "$app_dir/src/main.js" "$@"

#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
mode=${1:-hardware}
case "$mode" in
  hardware|full-app) export WEBKIT_DMABUF_RENDERER_FORCE_SHM=0 ;;
  shared-memory) export WEBKIT_DMABUF_RENDERER_FORCE_SHM=1 ;;
  *) echo 'Usage: diagnose-rendering.sh [hardware|shared-memory|full-app]' >&2; exit 2 ;;
esac
# Keep WebGL enabled in both runs. Only change WebKit's frame transport to GTK.
unset WEBKIT_DISABLE_DMABUF_RENDERER
probe_dir=$(mktemp -d /tmp/wallshader-render-probe.XXXXXX)
trap 'rm -rf -- "$probe_dir"' EXIT HUP INT TERM
source_state=${XDG_CONFIG_HOME:-$HOME/.config}/wallshader/state.json
export GSETTINGS_BACKEND=memory
export XDG_CONFIG_HOME="$probe_dir/config"
export XDG_DATA_HOME="$probe_dir/data"
export XDG_CACHE_HOME="$probe_dir/cache"
export GTK_A11Y=none
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
cd "$app_dir"
if [ ! -f build/renderer/renderer.js ]; then bun run build; fi
if [ "$mode" = full-app ]; then
  if [ -f "$source_state" ]; then
    mkdir -p "$XDG_CONFIG_HOME/wallshader"
    cp -- "$source_state" "$XDG_CONFIG_HOME/wallshader/state.json"
  fi
  # The full editor must not connect its live controls to the real Shell.
  dbus-run-session -- gjs -m "$app_dir/src/main.js"
else
  gjs -m "$app_dir/tests/rendering-probe.js" "$mode"
fi

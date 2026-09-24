#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bun run build
native_display_dir=$(mktemp -d /tmp/wallshader-native-display.XXXXXX)
trap 'fusermount3 -u "$native_display_dir/runtime/doc" 2>/dev/null || true; rm -rf -- "$native_display_dir"' EXIT HUP INT TERM
export WALLSHADER_KITTY_TEST_DIR="$native_display_dir/exports"
export XDG_RUNTIME_DIR="$native_display_dir/runtime"
export XDG_CONFIG_HOME="$native_display_dir/config"
export XDG_DATA_HOME="$native_display_dir/data"
export XDG_CACHE_HOME="$native_display_dir/cache"
export XDG_DATA_DIRS="$XDG_DATA_HOME:/usr/local/share:/usr/share"
export GSETTINGS_BACKEND=memory
export GTK_A11Y=none
export GDK_BACKEND=wayland
export WALLSHADER_NATIVE_DISPLAY="wallshader-native-$$"
mkdir -m 700 "$XDG_RUNTIME_DIR"
mkdir -p "$WALLSHADER_KITTY_TEST_DIR"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME/gnome-shell/modes"
cat > "$XDG_DATA_HOME/gnome-shell/modes/wallshader-native.json" <<'JSON'
{"parentMode":"user","showWelcomeDialog":false,"enabledExtensions":[]}
JSON
unset DISPLAY
dbus-run-session -- sh -c '
  set -eu
  gnome-shell --headless --wayland --no-x11 --virtual-monitor=1400x1000 --wayland-display="$WALLSHADER_NATIVE_DISPLAY" --mode=wallshader-native > "$WALLSHADER_KITTY_TEST_DIR/../compositor.log" 2>&1 &
  shell_pid=$!
  trap '\''kill -TERM "$shell_pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  attempt=0
  while [ ! -S "$XDG_RUNTIME_DIR/$WALLSHADER_NATIVE_DISPLAY" ]; do
    kill -0 "$shell_pid" 2>/dev/null || exit 1
    attempt=$((attempt + 1))
    [ "$attempt" -lt 50 ] || exit 1
    sleep 0.2
  done
  export WAYLAND_DISPLAY="$WALLSHADER_NATIVE_DISPLAY"
  gjs -m tests/kitty-render-export.js
  python3 tests/kitty-render.py
  python3 tests/kitty-reload.py
'

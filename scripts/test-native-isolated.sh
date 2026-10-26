#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/wallshader-test.XXXXXX)
trap 'fusermount3 -u "$test_dir/runtime/doc" 2>/dev/null || true; fusermount3 -u "$test_dir/runtime/gvfs" 2>/dev/null || true; rm -rf -- "$test_dir"' EXIT HUP INT TERM
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CACHE_HOME="$test_dir/cache"
export XDG_RUNTIME_DIR="$test_dir/runtime"
export KITTY_CONFIG_DIRECTORY="$XDG_CONFIG_HOME/kitty"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
mkdir -m 700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY GNOME_SETUP_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
export GSETTINGS_BACKEND=memory
export GTK_A11Y=none
export GDK_BACKEND=wayland
export WALLSHADER_TEST_DISPLAY="wallshader-native-$$"
export WALLSHADER_ARTIFACTS="${WALLSHADER_ARTIFACTS:-$app_dir/artifacts}"
mkdir -p "$WALLSHADER_ARTIFACTS"
cd "$app_dir"
if [ "$#" -eq 0 ]; then set -- bun run test:native; fi
# Variables in this script are expanded by the child shell on the private bus.
# shellcheck disable=SC2016
dbus-run-session -- sh -c '
  gnome-shell --headless --wayland --no-x11 --virtual-monitor=1920x1080 \
    --wayland-display="$WALLSHADER_TEST_DISPLAY" \
    > "$WALLSHADER_ARTIFACTS/native-desktop.log" 2>&1 &
  shell_pid=$!
  trap '\''kill -TERM "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  attempt=0
  while [ ! -S "$XDG_RUNTIME_DIR/$WALLSHADER_TEST_DISPLAY" ]; do
    kill -0 "$shell_pid" 2>/dev/null || { cat "$WALLSHADER_ARTIFACTS/native-desktop.log"; exit 1; }
    attempt=$((attempt + 1))
    [ "$attempt" -lt 30 ] || { cat "$WALLSHADER_ARTIFACTS/native-desktop.log"; exit 1; }
    sleep 1
  done
  export WAYLAND_DISPLAY="$WALLSHADER_TEST_DISPLAY"
  timeout "${WALLSHADER_TEST_TIMEOUT:-300}" "$@"
' sh "$@"

#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/wallshader-shell-test.XXXXXX)
trap 'fusermount3 -u "$test_dir/runtime/doc" 2>/dev/null || true; fusermount3 -u "$test_dir/runtime/gvfs" 2>/dev/null || true; rm -rf -- "$test_dir"' EXIT HUP INT TERM
cd "$app_dir"
if [ -z "${WALLSHADER_TEST_PACKAGE_DIR:-}" ]; then
  bun run build:extension
fi
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CACHE_HOME="$test_dir/cache"
export XDG_RUNTIME_DIR="$test_dir/runtime"
mkdir -m 700 "$XDG_RUNTIME_DIR"
export XDG_DATA_DIRS="$XDG_DATA_HOME:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
unset DISPLAY WAYLAND_DISPLAY GNOME_SETUP_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
export GSETTINGS_BACKEND=memory
export GTK_A11Y=none
export GDK_BACKEND=wayland
export WALLSHADER_TRACE=1
export WALLSHADER_TEST_APP_DIR="$app_dir"
export WALLSHADER_ARTIFACTS="${WALLSHADER_ARTIFACTS:-$app_dir/artifacts}"
export WALLSHADER_SHELL_TEST_RESULT="$test_dir/result"
export WALLSHADER_SHELL_TEST_LOG="$WALLSHADER_ARTIFACTS/shell-test.log"
if [ "${WALLSHADER_PERFORMANCE_TEST:-0}" = 1 ]; then
  export WALLSHADER_SHELL_TEST_LOG="$WALLSHADER_ARTIFACTS/shell-performance.log"
  export WALLSHADER_TRACE=0
fi
export WALLSHADER_TEST_DISPLAY="wallshader-test-$$"
# Exercise both the common single-monitor desktop and the multi-monitor path.
export WALLSHADER_TEST_MONITORS="${WALLSHADER_TEST_MONITORS:-2}"
case "$WALLSHADER_TEST_MONITORS" in
  1|2) ;;
  *) echo 'WALLSHADER_TEST_MONITORS must be 1 or 2' >&2; exit 1 ;;
esac
extension_dir="$XDG_DATA_HOME/gnome-shell/extensions"
if [ -n "${WALLSHADER_TEST_PACKAGE_DIR:-}" ]; then
  extension_dir="$test_dir/system/gnome-shell/extensions"
  export XDG_DATA_DIRS="$test_dir/system:$XDG_DATA_DIRS"
  export WALLSHADER_TEST_APP_DIR="$WALLSHADER_TEST_PACKAGE_DIR/share/wallshader"
  export WALLSHADER_MANAGED_EXTENSION="$WALLSHADER_TEST_APP_DIR/extension"
fi
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$extension_dir/wallshader-test@local" "$XDG_DATA_HOME/gnome-shell/modes" "$WALLSHADER_ARTIFACTS"
mkdir -p "$XDG_DATA_HOME/applications"
if [ -n "${WALLSHADER_TEST_PACKAGE_DIR:-}" ]; then
  cp "$WALLSHADER_TEST_PACKAGE_DIR/share/applications/io.github.wallshader.Wallshader.desktop" "$XDG_DATA_HOME/applications/"
  ln -s "$WALLSHADER_MANAGED_EXTENSION" "$extension_dir/wallshader@wallshader.github.io"
else
cat > "$XDG_DATA_HOME/applications/io.github.wallshader.Wallshader.desktop" <<EOF
[Desktop Entry]
Name=Wallshader
Exec=gjs -m "$app_dir/src/main.js"
Type=Application
EOF
cp -R build/extension "$extension_dir/wallshader@wallshader.github.io"
fi
cp tests/shell-driver.js "$extension_dir/wallshader-test@local/extension.js"
cp tests/shell-performance.js "$extension_dir/wallshader-test@local/shell-performance.js"
cp tests/resize-client.js "$extension_dir/wallshader-test@local/resize-client.js"
cat > "$extension_dir/wallshader-test@local/metadata.json" <<'JSON'
{"uuid":"wallshader-test@local","name":"Wallshader Test","description":"Isolated integration tests","shell-version":["50","51"],"session-modes":["wallshader-test","user","unlock-dialog"]}
JSON
cat > "$XDG_DATA_HOME/gnome-shell/modes/wallshader-test.json" <<'JSON'
{"parentMode":"user","showWelcomeDialog":false,"enabledExtensions":["wallshader@wallshader.github.io","wallshader-test@local"]}
JSON
# Variables in this script are expanded by the child shell on the private bus.
# shellcheck disable=SC2016
dbus-run-session -- sh -c '
  set -- --virtual-monitor=2560x1600
  if [ "${WALLSHADER_PERFORMANCE_TEST:-0}" = 1 ]; then
    set -- --virtual-monitor=3840x2160
  fi
  if [ "$WALLSHADER_TEST_MONITORS" = 2 ]; then
    set -- "$@" --virtual-monitor=800x600
  fi
  gnome-shell --headless --wayland --no-x11 "$@" --wayland-display="$WALLSHADER_TEST_DISPLAY" --mode=wallshader-test > "$WALLSHADER_SHELL_TEST_LOG" 2>&1 &
  shell_pid=$!
  trap '\''kill -TERM "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  attempt=0
  # Include cold renderer startup and per-frame overview/resize screenshots.
  while [ ! -f "$WALLSHADER_SHELL_TEST_RESULT" ] && [ "$attempt" -lt "${WALLSHADER_TEST_TIMEOUT:-300}" ]; do
    kill -0 "$shell_pid" 2>/dev/null || break
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ ! -f "$WALLSHADER_SHELL_TEST_RESULT" ]; then
    tail -50 "$WALLSHADER_SHELL_TEST_LOG"
    exit 1
  fi
  cat "$WALLSHADER_SHELL_TEST_RESULT"
  test "$(cat "$WALLSHADER_SHELL_TEST_RESULT")" = PASS
'

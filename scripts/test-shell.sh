#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/wallshader-shell-test.XXXXXX)
trap 'fusermount3 -uz "$test_dir/runtime/doc" 2>/dev/null || true; fusermount3 -uz "$test_dir/runtime/gvfs" 2>/dev/null || true; rm -rf -- "$test_dir"' EXIT HUP INT TERM
cd "$app_dir"
bun run build:extension
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CACHE_HOME="$test_dir/cache"
export XDG_RUNTIME_DIR="$test_dir/runtime"
export FLATPAK_USER_DIR="$test_dir/flatpak"
mkdir -m 700 "$XDG_RUNTIME_DIR"
export XDG_DATA_DIRS="$XDG_DATA_HOME:/usr/local/share:/usr/share"
unset DISPLAY WAYLAND_DISPLAY GNOME_SETUP_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
export GSETTINGS_BACKEND=memory
export GTK_A11Y=none
export GDK_BACKEND=wayland
export WALLSHADER_TRACE=1
export WALLSHADER_TEST_APP_DIR="$app_dir"
export WALLSHADER_ARTIFACTS="$app_dir/artifacts"
export WALLSHADER_SHELL_TEST_RESULT="$test_dir/result"
export WALLSHADER_SHELL_TEST_LOG="$app_dir/artifacts/shell-test.log"
if [ "${WALLSHADER_TEST_FLATPAK:-0}" = 1 ]; then
  export WALLSHADER_SHELL_TEST_LOG="$app_dir/artifacts/flatpak-live-shell.log"
fi
if [ "${WALLSHADER_PERFORMANCE_TEST:-0}" = 1 ]; then
  export WALLSHADER_SHELL_TEST_LOG="$app_dir/artifacts/shell-performance.log"
  export WALLSHADER_TRACE=0
fi
export WALLSHADER_TEST_DISPLAY="wallshader-test-$$"
# Exercise both the common single-monitor desktop and the multi-monitor path.
export WALLSHADER_TEST_MONITORS="${WALLSHADER_TEST_MONITORS:-2}"
case "$WALLSHADER_TEST_MONITORS" in
  1|2) ;;
  *) echo 'WALLSHADER_TEST_MONITORS must be 1 or 2' >&2; exit 1 ;;
esac
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local" "$XDG_DATA_HOME/gnome-shell/modes" "$WALLSHADER_ARTIFACTS"
mkdir -p "$XDG_DATA_HOME/applications"
cat > "$XDG_DATA_HOME/applications/io.github.wallshader.Wallshader.desktop" <<EOF
[Desktop Entry]
Name=Wallshader
Exec=gjs -m "$app_dir/src/main.js"
Type=Application
EOF
cp -R build/extension "$XDG_DATA_HOME/gnome-shell/extensions/wallshader@wallshader.github.io"
cp tests/shell-driver.js "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local/extension.js"
if [ "${WALLSHADER_TEST_FLATPAK:-0}" = 1 ]; then
  cp tests/shell-flatpak-driver.js "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local/extension.js"
fi
cp tests/shell-performance.js "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local/shell-performance.js"
cp tests/resize-client.js "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local/resize-client.js"
cat > "$XDG_DATA_HOME/gnome-shell/extensions/wallshader-test@local/metadata.json" <<'JSON'
{"uuid":"wallshader-test@local","name":"Wallshader Test","description":"Isolated integration tests","shell-version":["50","51"],"session-modes":["wallshader-test","user","unlock-dialog"]}
JSON
cat > "$XDG_DATA_HOME/gnome-shell/modes/wallshader-test.json" <<'JSON'
{"parentMode":"user","showWelcomeDialog":false,"enabledExtensions":["wallshader@wallshader.github.io","wallshader-test@local"]}
JSON
set -- dbus-run-session
if [ "${WALLSHADER_TEST_FLATPAK:-0}" = 1 ]; then
  mkdir -p "$test_dir/flatpak-app-data"
  set -- bwrap --bind / / --dev-bind /dev /dev --tmpfs "$HOME/.var" --dir "$HOME/.var/app" \
    --bind "$test_dir/flatpak-app-data" "$HOME/.var/app" --die-with-parent "$@"
fi
"$@" -- sh -c '
  portal_pid=
  if [ "${WALLSHADER_TEST_FLATPAK:-0}" = 1 ]; then
    flatpak install --user --assumeyes --noninteractive --no-deps --no-related "$WALLSHADER_TEST_APP_DIR/dist/flatpak/wallshader.flatpak" || exit 1
    gjs -m "$WALLSHADER_TEST_APP_DIR/tests/flatpak-portal-service.js" > "$WALLSHADER_ARTIFACTS/flatpak-live-portal.log" 2>&1 &
    portal_pid=$!
    attempt=0
    while [ ! -f "$XDG_RUNTIME_DIR/wallshader-portal-ready" ]; do
      kill -0 "$portal_pid" 2>/dev/null || exit 1
      attempt=$((attempt + 1))
      [ "$attempt" -lt 20 ] || exit 1
      sleep 1
    done
  fi
  set -- --virtual-monitor=2560x1600
  if [ "${WALLSHADER_PERFORMANCE_TEST:-0}" = 1 ]; then
    set -- --virtual-monitor=3840x2160
  fi
  if [ "$WALLSHADER_TEST_MONITORS" = 2 ]; then
    set -- "$@" --virtual-monitor=800x600
  fi
  gnome-shell --headless --wayland --no-x11 "$@" --wayland-display="$WALLSHADER_TEST_DISPLAY" --mode=wallshader-test > "$WALLSHADER_SHELL_TEST_LOG" 2>&1 &
  shell_pid=$!
  trap '\''kill -TERM "$shell_pid" ${portal_pid:+"$portal_pid"} 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
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

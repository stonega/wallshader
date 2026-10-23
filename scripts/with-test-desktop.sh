#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/wallshader-desktop-test.XXXXXX)
trap 'fusermount3 -uz "$test_dir/runtime/doc" 2>/dev/null || true; fusermount3 -uz "$test_dir/runtime/gvfs" 2>/dev/null || true; rm -rf -- "$test_dir"' EXIT HUP INT TERM
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CACHE_HOME="$test_dir/cache"
export XDG_RUNTIME_DIR="$test_dir/runtime"
export FLATPAK_USER_DIR="$test_dir/flatpak"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/gnome-shell/modes" "$XDG_CACHE_HOME"
mkdir -m 700 "$XDG_RUNTIME_DIR"
export XDG_DATA_DIRS="$XDG_DATA_HOME:/usr/local/share:/usr/share"
unset DISPLAY WAYLAND_DISPLAY GNOME_SETUP_DISPLAY XAUTHORITY DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
export GSETTINGS_BACKEND=memory
export GTK_A11Y=none
export GDK_BACKEND=wayland
export WALLSHADER_ARTIFACTS="$app_dir/artifacts"
export WALLSHADER_TEST_DISPLAY="wallshader-test-$$"
mkdir -p "$WALLSHADER_ARTIFACTS"
mkdir -p "$test_dir/flatpak-app-data"
cat > "$XDG_DATA_HOME/gnome-shell/modes/wallshader-test.json" <<'JSON'
{"parentMode":"user","showWelcomeDialog":false,"enabledExtensions":[]}
JSON
# Flatpak derives per-app data from ~/.var/app rather than the XDG overrides.
# Give every process on the private bus the same temporary view of that path.
bwrap --bind / / --dev-bind /dev /dev --tmpfs "$HOME/.var" --dir "$HOME/.var/app" \
  --bind "$test_dir/flatpak-app-data" "$HOME/.var/app" --die-with-parent \
  dbus-run-session -- sh -eu -c '
  gnome-shell --headless --wayland --no-x11 --virtual-monitor=1280x1024 \
    --wayland-display="$WALLSHADER_TEST_DISPLAY" --mode=wallshader-test \
    > "$WALLSHADER_ARTIFACTS/test-desktop.log" 2>&1 &
  shell_pid=$!
  trap '\''kill -TERM "$shell_pid" 2>/dev/null || true; wait "$shell_pid" 2>/dev/null || true'\'' EXIT HUP INT TERM
  attempt=0
  while [ ! -S "$XDG_RUNTIME_DIR/$WALLSHADER_TEST_DISPLAY" ]; do
    kill -0 "$shell_pid"
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      cat "$WALLSHADER_ARTIFACTS/test-desktop.log"
      exit 1
    fi
    sleep 1
  done
  export WAYLAND_DISPLAY="$WALLSHADER_TEST_DISPLAY"
  timeout "${WALLSHADER_TEST_TIMEOUT:-300}" "$@"
' sh "$@"

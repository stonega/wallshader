#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$app_dir"
if [ "${1:-}" != --inside-desktop ]; then
  exec ./scripts/with-test-desktop.sh "$0" --inside-desktop
fi
gjs -m tests/flatpak-portal-service.js > "$WALLSHADER_ARTIFACTS/flatpak-portal.log" 2>&1 &
portal_pid=$!
trap 'kill -TERM "$portal_pid" 2>/dev/null || true; wait "$portal_pid" 2>/dev/null || true' EXIT HUP INT TERM
attempt=0
while [ ! -f "$XDG_RUNTIME_DIR/wallshader-portal-ready" ]; do
  kill -0 "$portal_pid"
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    cat "$WALLSHADER_ARTIFACTS/flatpak-portal.log"
    exit 1
  fi
  sleep 1
done
# Install only into the virtual desktop's temporary Flatpak installation. This
# also lets GNOME's sandboxed image loaders find their parent application.
flatpak install --user --assumeyes --noninteractive --no-deps --no-related \
  "$app_dir/dist/flatpak/wallshader.flatpak"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/other-extension@local"
printf 'untouched' > "$XDG_DATA_HOME/gnome-shell/extensions/other-extension@local/guard"
flatpak run --user --command=gjs --no-a11y-bus --no-documents-portal \
  --filesystem="$app_dir/tests:ro" --filesystem="$WALLSHADER_ARTIFACTS" \
  --env=GSETTINGS_BACKEND=memory --env=GTK_A11Y=none --env=GDK_BACKEND=wayland \
  --env=WALLSHADER_LOCALEDIR=/app/share/locale \
  --env=WALLSHADER_ARTIFACTS="$WALLSHADER_ARTIFACTS" \
  io.github.stonega.wallshader -m "$app_dir/tests/flatpak-smoke.js"
# Synthetic sandbox parent directories may be writable, but host siblings must
# remain inaccessible and unchanged.
test "$(cat "$XDG_DATA_HOME/gnome-shell/extensions/other-extension@local/guard")" = untouched
test ! -e "$XDG_DATA_HOME/gnome-shell/extensions/other-extension@local/unexpected"

#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/wallshader-test.XXXXXX)
trap 'rm -rf -- "$test_dir"' EXIT HUP INT TERM
cd "$app_dir"
bun run build
export GSETTINGS_BACKEND=memory
export XDG_CONFIG_HOME="$test_dir/config"
export XDG_DATA_HOME="$test_dir/data"
export XDG_CACHE_HOME="$test_dir/cache"
export KITTY_CONFIG_DIRECTORY="$test_dir/config/kitty"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
if [ -n "${WALLSHADER_TEST_LANGUAGE:-}" ]; then
  python3 - <<'PY'
import json
import os
from pathlib import Path
directory = Path(os.environ['XDG_CONFIG_HOME']) / 'wallshader'
directory.mkdir(parents=True, exist_ok=True)
(directory / 'state.json').write_text(json.dumps({'language': os.environ['WALLSHADER_TEST_LANGUAGE']}))
PY
fi
export WALLSHADER_ARTIFACTS="${WALLSHADER_ARTIFACTS:-$app_dir/artifacts}"
if [ "$#" -eq 0 ]; then set -- --smoke-test; fi
export GTK_A11Y=none
dbus-run-session -- timeout "${WALLSHADER_TEST_TIMEOUT:-240}" gjs -m "$app_dir/src/main.js" "$@"

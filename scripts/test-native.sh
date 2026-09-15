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
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
export WALLSHADER_ARTIFACTS="$app_dir/artifacts"
timeout 240 gjs -m "$app_dir/src/main.js" --smoke-test

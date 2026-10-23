#!/bin/sh
set -eu
app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$app_dir"
mkdir -p dist/flatpak
flatpak-builder --user --force-clean --install-deps-from=flathub \
  --mirror-screenshots-url=https://dl.flathub.org/media \
  --compose-url-policy=full \
  --repo=dist/flatpak/repo build-flatpak \
  packaging/flatpak/io.github.stonega.wallshader.json "$@"
flatpak build-bundle dist/flatpak/repo \
  dist/flatpak/wallshader.flatpak io.github.stonega.wallshader \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
cp build-flatpak/files/share/wallshader/wallshader-extension.zip dist/flatpak/wallshader-extension.zip
(cd dist/flatpak && sha256sum wallshader.flatpak wallshader-extension.zip > SHA256SUMS)

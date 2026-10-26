{
  lib,
  stdenv,
  fetchurl,
  bun,
  gettext,
  meson,
  ninja,
  pkg-config,
  desktop-file-utils,
  gobject-introspection,
  wrapGAppsHook4,
  gjs,
  gtk4,
  libadwaita,
  webkitgtk_6_0,
  gsettings-desktop-schemas,
  runCommand,
}:
let
  manifest = lib.importJSON ../package.json;
  paperVersion = manifest.dependencies."@paper-design/shaders";
  paper = fetchurl {
    url = "https://registry.npmjs.org/@paper-design/shaders/-/shaders-${paperVersion}.tgz";
    hash = "sha256-ZeMRBiOenC2ovlLENx1h7+Yl+pX7nylEl3vpYiwquog=";
  };
  extensionUuid = "wallshader@wallshader.github.io";
  runtimeInputs = [
    gjs
    gtk4
    libadwaita
    webkitgtk_6_0
    gsettings-desktop-schemas
  ];
  # Hash an independent launcher path into the extension, never its own $out:
  # Nix temporarily rewrites $out during reproducibility checks.
  rendererLauncher = stdenv.mkDerivation {
    name = "wallshader-gjs";
    dontUnpack = true;
    nativeBuildInputs = [
      gobject-introspection
      wrapGAppsHook4
    ];
    buildInputs = runtimeInputs;
    dontWrapGApps = true;
    installPhase = ''
      mkdir -p "$out/bin"
    '';
    preFixup = ''
      makeWrapper ${lib.getExe gjs} "$out/bin/wallshader-gjs" "''${gappsWrapperArgs[@]}"
    '';
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "wallshader";
  version = manifest.version;

  src = lib.fileset.toSource {
    root = ./..;
    fileset = lib.fileset.unions [
      ../src
      ../extension
      ../data
      ../po
      ../scripts
      ../meson.build
      ../package.json
      ../bun.lock
      ../COPYING
    ];
  };

  strictDeps = true;
  nativeBuildInputs = [
    bun
    gettext
    meson
    ninja
    pkg-config
    desktop-file-utils
    gjs
    gobject-introspection
    wrapGAppsHook4
  ];
  buildInputs = runtimeInputs;

  preConfigure = ''
    mkdir -p node_modules/@paper-design/shaders
    tar -xzf ${paper} --strip-components=1 -C node_modules/@paper-design/shaders
    # Paper 0.0.81 uses undefined equal-edge smoothstep for imported metal logos.
    patch -d node_modules/@paper-design/shaders -p1 < ${./patches/paper-liquid-metal-frame.patch}
    cat >> node_modules/@paper-design/shaders/NOTICE <<'NOTICE'

    Wallshader Nix packaging modifies Liquid Metal's zero-width image frame
    to avoid undefined equal-edge smoothstep behavior in GLSL.
    NOTICE
    export WALLSHADER_RENDERER_LAUNCHER="${rendererLauncher}/bin/wallshader-gjs"
    bun run build
  '';

  postInstall = ''
    mkdir -p "$out/libexec"
    ln -s ${rendererLauncher}/bin/wallshader-gjs "$out/libexec/wallshader-gjs"
    mkdir -p "$out/share/gnome-shell/extensions"
    ln -s "$out/share/wallshader/extension" \
      "$out/share/gnome-shell/extensions/${extensionUuid}"
    substituteInPlace "$out/share/applications/io.github.wallshader.Wallshader.desktop" \
      --replace-fail 'Exec=wallshader' "Exec=$out/bin/wallshader"
    desktop-file-validate "$out/share/applications/io.github.wallshader.Wallshader.desktop"
  '';

  dontWrapGApps = true;
  preFixup = ''
    wrapGApp "$out/bin/wallshader" \
      --set WALLSHADER_MANAGED_EXTENSION "$out/share/wallshader/extension"
  '';

  passthru = {
    inherit extensionUuid;
    tests.installed = runCommand "wallshader-installed" { } ''
      test -x ${finalAttrs.finalPackage}/bin/wallshader
      test -x ${finalAttrs.finalPackage}/libexec/wallshader-gjs
      test -f ${finalAttrs.finalPackage}/share/gnome-shell/extensions/${extensionUuid}/app/build/renderer/renderer.js
      ${finalAttrs.finalPackage}/libexec/wallshader-gjs -c '
        imports.gi.versions.Gtk = "4.0";
        imports.gi.versions.WebKit = "6.0";
        const { Gtk, Adw, WebKit, GdkPixbuf, Gio } = imports.gi;
        if (!Gtk || !Adw || !WebKit || !GdkPixbuf) throw new Error("Missing runtime typelibs");
        const source = Gio.SettingsSchemaSource.get_default();
        if (!source?.lookup("org.gnome.desktop.background", true))
          throw new Error("Missing background schema");
      '
      touch "$out"
    '';
  };

  meta = {
    description = "Native GNOME wallpapers made with Paper Shaders";
    homepage = "https://github.com/stonega/wallshader";
    license = lib.licenses.gpl3Plus;
    mainProgram = "wallshader";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})

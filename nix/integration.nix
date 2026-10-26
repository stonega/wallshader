{
  lib,
  pkgs,
  wallshader,
}:
let
  testSource = lib.fileset.toSource {
    root = ./..;
    fileset = lib.fileset.unions [
      ../tests
      ../scripts
    ];
  };
  testImages = lib.fileset.toSource {
    root = ./..;
    fileset = ../src/renderer/sample-logo.svg;
  };
  # Exercise the installed modules and resources with the existing native suite.
  nativeTests = pkgs.runCommand "wallshader-installed-native-tests" { } ''
    mkdir -p "$out"
    substitute ${../src/main.js} "$out/main.js" \
      --replace-fail "from './" "from 'file://${wallshader}/share/wallshader/src/" \
      --replace-fail "'../tests/native-smoke.js'" "'file://$out/native-smoke.js'"
    for name in native-smoke.js kitty-native.js; do
      substitute ${../tests}/"$name" "$out/$name" \
        --replace-fail "from '../src/" "from 'file://${wallshader}/share/wallshader/src/"
    done
    substituteInPlace "$out/native-smoke.js" \
      --replace-fail "import { ROOT } from 'file://${wallshader}/share/wallshader/src/paths.js';" "const ROOT = '${testImages}';"
  '';
in
pkgs.testers.runNixOSTest {
  name = "wallshader";
  nodes.machine = { ... }: {
    services.xserver.enable = true;
    services.desktopManager.gnome.enable = true;
    services.displayManager.gdm.enable = false;
    environment.systemPackages = [
      wallshader
      pkgs.gnome-shell
      pkgs.gjs
    ];
    virtualisation.memorySize = 4096;
    virtualisation.cores = 4;
    virtualisation.diskSize = 8192;
  };
  testScript = ''
    machine.start()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mkdir -p /tmp/wallshader-artifacts")
    try:
        machine.succeed("WALLSHADER_TEST_TIMEOUT=600 WALLSHADER_ARTIFACTS=/tmp/wallshader-artifacts WALLSHADER_LOCALEDIR=${wallshader}/share/locale WALLSHADER_MANAGED_EXTENSION=${wallshader}/share/wallshader/extension ${pkgs.bash}/bin/bash ${testSource}/scripts/test-native-isolated.sh ${wallshader}/libexec/wallshader-gjs -m ${nativeTests}/main.js --smoke-test", timeout=660)
        machine.succeed("WALLSHADER_TEST_TIMEOUT=600 WALLSHADER_ARTIFACTS=/tmp/wallshader-artifacts WALLSHADER_TEST_PACKAGE_DIR=${wallshader} ${pkgs.bash}/bin/bash ${testSource}/scripts/test-shell.sh", timeout=660)
    finally:
        machine.copy_from_vm("/tmp/wallshader-artifacts", "artifacts")
  '';
}

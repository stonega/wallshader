{
  description = "Native GNOME wallpapers made with Paper Shaders";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          wallshader = pkgs.callPackage ./nix/package.nix { };
        in
        {
          inherit wallshader;
          default = wallshader;
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          wallshader = self.packages.${system}.wallshader;
        in
        {
          inherit wallshader;
          installed = wallshader.tests.installed;
        }
        // nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          integration = pkgs.callPackage ./nix/integration.nix { inherit wallshader; };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}

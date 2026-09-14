{
  description = "Webfox: configurable web access from the terminal";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    {
      packages = nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ] (system: {
        default = nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { };
      });
    };
}

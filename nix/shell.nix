{
  lib,
  mkShell,
  nodejs_24,
  bun,
  biome,
  git,
  jq,
  lefthook,
  uv,
  actionlint,
  nixfmt,
}:

mkShell {
  packages = [
    nodejs_24
    bun
    biome
    git
    jq
    lefthook
    uv
    actionlint
    nixfmt
  ];

  # Use the Nix binary even when package scripts invoke Biome's npm wrapper.
  # The npm Linux binary requires a loader that isn't available on NixOS.
  BIOME_BINARY = lib.getExe biome;
}

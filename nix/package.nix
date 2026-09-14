{
  lib,
  buildNpmPackage,
  nodejs_24,
  biome,
}:

let
  project = lib.importJSON ../package.json;
in
buildNpmPackage {
  pname = "webfox";
  inherit (project) version;
  src = lib.cleanSource ../.;

  nodejs = nodejs_24;
  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-f1M39ukHmA4pKwEhZa5MfG7rCRJCr1UiTzYHb2Mvznw=";

  # Build explicitly after npm ci, rather than through the prepare lifecycle.
  npmFlags = [ "--ignore-scripts" ];

  # npm's Linux Biome binary expects a loader outside the Nix store.
  preBuild = ''
    ln -sf ${lib.getExe biome} node_modules/.bin/biome
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    "$out/bin/web" --version | grep -Fx '${project.version}'
    "$out/bin/web" --help > /dev/null
    "$out/bin/web" providers > /dev/null
    runHook postInstallCheck
  '';

  meta = {
    inherit (project) description;
    homepage = "https://github.com/mavam/webfox";
    license = lib.licenses.mit;
    mainProgram = "web";
    platforms = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
}

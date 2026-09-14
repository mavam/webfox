{
  lib,
  buildNpmPackage,
  nodejs_24,
  biome,
  jq,
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
  npmDepsHash = "sha256-H/giK59DxaxWFeBGW2giGbm5+VJT2rmMpLyQPKhIn9w=";

  # Root package versions do not affect dependencies. Normalize them in both
  # the fetcher and build so release bumps preserve the dependency cache hash.
  postPatch = ''
    ${lib.getExe jq} '.version = "0.0.0" | .packages[""].version = "0.0.0"' \
      package-lock.json > package-lock.json.tmp
    mv package-lock.json.tmp package-lock.json
  '';

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

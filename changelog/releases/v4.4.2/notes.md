Webfox simplifies its Nix flake to one default package per supported platform. Build and smoke-test the CLI with nix build, without separate overlays, aliases, or check outputs.

## 🐞 Bug fixes

### Simplify the Nix flake interface

The Nix flake now exposes only `packages.<system>.default`, replacing the named `webfox` package and overlay. Use `nix build` to build and smoke-test the CLI; the separate check and formatter outputs are removed.

*By @mavam.*

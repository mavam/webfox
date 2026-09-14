---
title: Simplify the Nix flake interface
type: breaking
authors:
  - mavam
created: 2026-09-14T15:57:21.541442Z
---

The Nix flake now exposes only `packages.<system>.default`, replacing the named `webfox` package and overlay. Use `nix build` to build and smoke-test the CLI; the separate check and formatter outputs are removed.

---
title: Reproducible Nix development shell
type: feature
authors:
  - mavam
  - codex
created: 2026-09-20T09:25:59.267793Z
---

Contributors can now run `nix develop` to enter a pinned development environment with Node.js 24, Bun, and the project’s maintenance tools. With direnv and nix-direnv configured, `direnv allow` enables automatic activation when entering the checkout.

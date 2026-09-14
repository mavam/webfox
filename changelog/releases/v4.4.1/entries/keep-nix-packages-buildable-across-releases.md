---
title: Keep Nix packages buildable across releases
type: bugfix
authors:
  - mavam
created: 2026-09-14T15:16:52.957124Z
---

Nix installations now keep working after a Webfox release changes the package version. Version-only releases no longer invalidate the pinned dependency cache.

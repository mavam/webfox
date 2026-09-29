---
title: Fix Pi's host-provided package warning
type: bugfix
authors:
  - mavam
created: 2026-09-29T17:57:06.712562Z
---

Pi no longer warns that webfox lists `typebox` in `dependencies`. The package now declares `typebox` as a peer dependency, so Pi supplies its own copy to the extension and avoids duplicate runtime modules. Standalone installs of the `web` CLI and TypeScript library keep working because package managers install required peer dependencies automatically.

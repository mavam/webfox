---
title: Homebrew installation for the web command
type: feature
authors:
  - mavam
prs:
  - 47
created: 2026-09-11T05:28:09.483988Z
---

You can now install the `web` command with Homebrew on macOS and Linux:

```sh
brew install mavam/tap/webfox
```

Homebrew manages Node.js and the command's dependencies. The npm installation
option remains available. To use Webfox in Pi, install the extension separately
with `pi install npm:webfox`; this doesn't add `web` to your shell's `PATH`.
The CLI and Pi extension share the same Webfox configuration.

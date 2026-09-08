---
title: Non-blocking Pi startup with invalid configuration
type: bugfix
authors:
  - mavam
prs:
  - 42
created: 2026-09-08T04:50:33.84218Z
---

Invalid Webfox configuration no longer interrupts Pi startup. The extension reports the configuration error and registers no web tools, leaving Pi available to use. In print and JSON modes, the diagnostic goes to stderr. After fixing the configuration, restart Pi or run `/reload` to load the extension again.

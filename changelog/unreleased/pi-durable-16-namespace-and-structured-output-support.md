---
title: Pi Durable 1.6 namespace and structured output support
type: change
authors:
  - mavam
prs:
  - 63
created: 2026-11-22T20:09:17.099896Z
---

The `webfox/durable` adapter now targets Pi Durable 1.6 (`@earendil-works/pi-durable@^1.6.0`), registers its tools under the `web` namespace, and exposes structured result schemas so codemode scripts receive complete result documents.

```ts
import { createWebfoxExtension } from "webfox/durable";

registry.install(createWebfoxExtension({ cwd: process.cwd() }));
```

Model-facing tool results also now return the rendered web response on Pi Durable 1.2+ instead of falling back to streamed progress lines. In the standard Pi extension, tool call headers now use Pi 1.6's host keybinding formatter when available.

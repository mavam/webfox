---
title: Pi Durable web tools
type: feature
authors:
  - mavam
prs:
  - 56
created: 2026-10-03T08:33:06.034175Z
---

Pi Durable hosts can now use Webfox's configured search, contents, answer, and
research capabilities directly:

```ts
import { createWebfoxExtension } from "webfox/durable";
registry.install(createWebfoxExtension({ cwd: process.cwd() }));
```

The adapter follows the conversation's working directory and cancellation,
shows provider progress, preserves partial failures, and saves oversized
results to private files. Interrupted requests are not replayed automatically,
since providers may charge for them. Normal Pi, library, and CLI support are
unchanged; the durable runtime is optional.

---
title: Web tool discovery in Pi codemode
type: change
authors:
  - mavam
created: 2026-09-30T07:18:27.616097Z
---

Webfox's Pi tools are now grouped under the `web` namespace, so you can discover them together from a codemode script:

```js
const found = await searchTools("search", { namespace: "web" });
text(found);
```

The tool names stay the same, and you can still call them directly without enabling codemode. The README now includes recipes for chaining search and page extraction, running independent calls in parallel, handling partial failures, and returning only selected evidence to the model.

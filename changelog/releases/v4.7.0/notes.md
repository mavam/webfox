Use your configured web tools in Pi Durable while keeping normal Pi, library, and command-line workflows. This release also groups normal Pi's web tools for codemode discovery.

## 🚀 Features

### Pi Durable web tools

Pi Durable hosts can now use Webfox's configured search, contents, answer, and research capabilities directly:

```ts
import { createWebfoxExtension } from "webfox/durable";
registry.install(createWebfoxExtension({ cwd: process.cwd() }));
```

The adapter follows the conversation's working directory and cancellation, shows provider progress, preserves partial failures, and saves oversized results to private files. Interrupted requests are not replayed automatically, since providers may charge for them. Normal Pi, library, and CLI support are unchanged; the durable runtime is optional.

*By @mavam in #56.*

## 🔧 Changes

### Web tool discovery in Pi codemode

Webfox's Pi tools are now grouped under the `web` namespace, so you can discover them together from a codemode script:

```js
const found = await searchTools("search", { namespace: "web" });
text(found);
```

The tool names stay the same, and you can still call them directly without enabling codemode. The README now includes recipes for chaining search and page extraction, running independent calls in parallel, handling partial failures, and returning only selected evidence to the model.

Tool descriptions now clarify that only model-facing text is truncated; codemode scripts receive complete structured results.

*By @mavam in #55.*

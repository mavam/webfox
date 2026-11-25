Webfox now calls every built-in provider directly without third-party provider libraries, shrinking standalone installs and enabling cancellation for Tavily and Valyu. This release also updates the Pi and Pi Durable adapters for version 1.6, adds new Tavily and Valyu options, and hardens secret redaction across providers.

## 🚀 Features

### New Tavily and Valyu provider options

The Tavily and Valyu providers now expose the latest options from their updated SDKs across the CLI, configuration schema, TypeScript library, and Pi tools:

- **Tavily search and contents**: `includeImageDescriptions`, `includeDomainsMode` (`restrict` or `prefer`), `maxAgeHours`, `fetchTimeout`, `cacheFallback`, `language`, `filterByLanguage`, `safeSearch`, `includePublishedDate`, `filterByPublishedDate`, and `includeUsage`. Credit usage returned by Tavily is now preserved in result metadata.
- **Valyu research**: `mode: "instant"`, `outputFormats: ["structured_report"]`, and `skills`. Valyu has deprecated its Answer API (retiring 2026-12-17); use `research` with `--mode instant` or `search` for new workflows.

```sh
web search "Node.js release notes" --provider tavily --safe-search --include-usage
web research "Compare Node.js and Bun" --provider valyu --mode instant
```

*By @mavam in #63.*

## 🔧 Changes

### Direct HTTP requests with zero provider SDK dependencies

Webfox no longer depends on any third-party provider SDK packages. The Cloudflare, OpenAI, Parallel, Perplexity, Tavily, and Valyu providers now call their REST APIs directly over HTTP, cutting standalone installs from 38 packages to 5.

All built-in HTTP providers—including Tavily and Valyu—now cancel in-flight HTTP requests directly when a timeout or cancellation signal fires. Provider options, CLI flags, configuration keys, and result formats remain unchanged.

*By @mavam in #66.*

### Pi Durable 1.6 namespace and structured output support

The `webfox/durable` adapter now targets Pi Durable 1.6 (`@earendil-works/pi-durable@^1.6.0`), registers its tools under the `web` namespace, and exposes structured result schemas so codemode scripts receive complete result documents.

```ts
import { createWebfoxExtension } from "webfox/durable";

registry.install(createWebfoxExtension({ cwd: process.cwd() }));
```

Model-facing tool results also now return the rendered web response on Pi Durable 1.2+ instead of falling back to streamed progress lines. In the standard Pi extension, tool call headers now use Pi 1.6's host keybinding formatter when available.

*By @mavam in #63.*

### Require Node.js 22.12.0 or later

Webfox now requires Node.js 22.12.0 or later to match Commander 15.1.

*By @mavam in #63.*

## 🐞 Bug fixes

### Fix webfox/durable standalone peer isolation and ExecutionEnv spill files

The `webfox/durable` entry point no longer imports `@earendil-works/pi-coding-agent` at runtime, so Pi Durable hosts can install and run `webfox/durable` without installing the Pi coding agent package.

Oversized tool results in `webfox/durable` are now written through the conversation's `ExecutionEnv` instead of local host temp directories, and truncated tool outputs keep their `Full results:` path inside the 2000-line / 50 KiB budget so Pi Durable's output limiter does not clip the file path.

*By @mavam in #67.*

### Redact all configured provider secrets during execution

Webfox now redacts all known configured and environment provider secrets from execution errors, progress updates, and results—not only the credentials resolved for the active provider. Previously, an error or custom command output echoing another configured provider's API key could pass through unredacted.

OpenAI requests and Gemini research submissions also now receive a per-input `Idempotency-Key` header.

*By @mavam in #65.*

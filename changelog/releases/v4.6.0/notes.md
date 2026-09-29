Webfox now returns structured results to scripts that call its Pi tools, so a partial result keeps its completed inputs instead of failing the script. This release also requires Pi 0.99 or later and adds a reproducible Nix development shell for contributors.

## 🚀 Features

### Reproducible Nix development shell

Contributors can now run `nix develop` to enter a pinned development environment with Node.js 24, Bun, and the project’s maintenance tools. With direnv and nix-direnv configured, `direnv allow` enables automatic activation when entering the checkout.

*By @mavam and @codex.*

### Structured web results for Pi codemode

The `web_search`, `web_contents`, `web_answer`, and `web_research` Pi tools now return their result document as structured output. Scripts that call them through Pi's codemode receive an object with the documented fields instead of text to parse. A partial result no longer makes the script fail: it receives the completed inputs together with the errors of the failed ones. The structured output is never truncated, and Pi keeps it out of the model's context.

*By @mavam in #54.*

## 🔧 Changes

### Declare Pi web tools as read-only

The `web_search`, `web_contents`, `web_answer`, and `web_research` Pi tools now declare themselves as read-only calls that reach the open web. Extensions that gate tool calls, such as permission prompts, can use these hints to decide what needs confirmation. Partial failures are also reported through the tool result itself, so they show as tool errors without a separate event handler. This requires Pi 0.99 or later.

*By @mavam in #53.*

## 🐞 Bug fixes

### Fix Pi's host-provided package warning

Pi no longer warns that webfox lists `typebox` in `dependencies`. The package now declares `typebox` as a peer dependency, so Pi supplies its own copy to the extension and avoids duplicate runtime modules. Standalone installs of the `web` CLI and TypeScript library keep working because package managers install required peer dependencies automatically.

*By @mavam in #53.*

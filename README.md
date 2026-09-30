<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/webfox-lockup-dark.png">
    <img src="./assets/webfox-lockup.png" alt="webfox" width="520">
  </picture>
</h1>

**The web, from your terminal.**

Search the web, extract pages, get grounded answers, and run deep research with
one command: `web`. Choose your providers, bring your API keys, and use the same
configuration in your terminal, TypeScript applications, and pi.

> [!IMPORTANT]
> **Coming from pi-web-providers?** Webfox continues the project as **v4.0.0**.
> Replace the old Pi package:
>
> ```sh
> pi remove npm:pi-web-providers
> pi install npm:webfox
> ```
>
> Recreate your provider defaults in the [Webfox configuration](./docs/reference.md#configuration)
> and restart pi. The old `~/.pi/agent/web-providers.json` settings aren't imported.

## 🚀 Installation

- **Terminal:** Install the `web` command with [Homebrew](https://github.com/mavam/homebrew-tap):

  ```sh
  brew install mavam/tap/webfox
  ```

  Or use npm:

  ```sh
  npm install -g webfox
  ```
- **Nix:** Run the CLI directly:

  ```sh
  nix run github:mavam/webfox -- --help
  ```

  The flake exports `packages.<system>.default` for Linux
  (`aarch64`, `x86_64`) and macOS (Apple Silicon).
- **TypeScript:** Add `webfox` as an application dependency.
- **Pi:** Install the extension:

  ```sh
  pi install npm:webfox
  ```

  This installs the extension, not the `web` command on your shell's `PATH`.
  Then follow [Use with Pi](#-use-with-pi) to select a web provider and supply its
  API key.

## ✨ Usage

Set an API key and make your first request. For example, with Brave Search:

```sh
export BRAVE_SEARCH_API_KEY=…
web search "Node.js release notes" --provider brave
```

Save your provider choice so you don't need to repeat it:

```sh
web config default search brave
web search "TypeBox validation"
```

Choose a provider for each capability, or override it with `--provider`. API keys
alone never select a provider.

### Four commands

```sh
web search "Node.js cancellation" "Bun cancellation"
web contents https://example.com/a https://example.com/b --provider tavily
web answer "What is MCP?" --provider openai --model gpt-6-astra
web research "Compare databases for an analytics service" --provider gemini --timeout 20m
```

Each provider needs its own credentials. Research runs in the foreground and
shows progress while you wait. Ctrl-C stops waiting, but may not cancel an
already-running, billable research job at the provider.

### Find providers and options

```sh
web providers
web providers openai
web search --help
web search --provider openai --help
```

Provider-specific help lists the options available for that provider, such as
models, source filters, and page extraction settings.

### Use pipes and scripts

Quote each independent query or question. Search and answer accept up to ten
inputs; research accepts one brief. Omit the input to read from a pipe or file:

```sh
# Read from files
web search < query.txt
web answer --provider openai < question.txt
web research --provider gemini < brief.md
web contents --provider tavily < urls.txt

# Pipe input
echo "What is MCP?" | web answer --provider openai
echo "https://example.com" | web contents --provider tavily

# Save or process JSON results
web search "TypeBox" --format json > results.json
web search "TypeBox" --format json | jq -r '.results[] | select(.ok) | .value.results[].url'
```

Contents reads one URL per line. The other commands read the entire stdin stream
as one input. Positional arguments take precedence over stdin; `-` is optional.
Text is the default, including when piped. Use `--format json` for structured
results; the last example uses `jq` to extract result URLs.

Results go to stdout; progress and errors go to stderr. `--quiet` hides progress
and success notices, not errors. Use `--timeout 30s` or `--timeout 20m` to set a
deadline, and `--no-color` or `NO_COLOR` to disable colors.

See the [CLI reference](./docs/cli-experience.md) for output formats, exit codes,
and scripting details.

## 🔌 Providers

Use different providers for different tasks:

| Provider     | Search | Contents | Answer | Research |
| ------------ | :----: | :------: | :----: | :------: |
| [Brave]      |   ✔︎    |          |   ✔︎    |    ✔︎     |
| [Cloudflare] |        |    ✔︎     |        |          |
| [Custom]     |   ✔︎    |    ✔︎     |   ✔︎    |    ✔︎     |
| [Exa]        |   ✔︎    |    ✔︎     |   ✔︎    |    ✔︎     |
| [Firecrawl]  |   ✔︎    |    ✔︎     |   ✔︎    |          |
| [Gemini]     |        |          |   ✔︎    |    ✔︎     |
| [Linkup]     |   ✔︎    |    ✔︎     |        |    ✔︎     |
| [Ollama]     |   ✔︎    |    ✔︎     |        |          |
| [OpenAI]     |   ✔︎    |          |   ✔︎    |    ✔︎     |
| [Parallel]   |   ✔︎    |    ✔︎     |        |          |
| [Perplexity] |   ✔︎    |          |   ✔︎    |    ✔︎     |
| [SerpBase]   |   ✔︎    |          |        |          |
| [Serper]     |   ✔︎    |          |        |          |
| [Tavily]     |   ✔︎    |    ✔︎     |        |          |
| [Valyu]      |   ✔︎    |    ✔︎     |   ✔︎    |    ✔︎     |
| [You.com]    |   ✔︎    |          |        |          |

[Brave]: ./docs/provider.md#brave
[Cloudflare]: ./docs/provider.md#cloudflare
[Custom]: ./docs/provider.md#custom
[Exa]: ./docs/provider.md#exa
[Firecrawl]: ./docs/provider.md#firecrawl
[Gemini]: ./docs/provider.md#gemini
[Linkup]: ./docs/provider.md#linkup
[Ollama]: ./docs/provider.md#ollama
[OpenAI]: ./docs/provider.md#openai
[Parallel]: ./docs/provider.md#parallel
[Perplexity]: ./docs/provider.md#perplexity
[SerpBase]: ./docs/provider.md#serpbase
[Serper]: ./docs/provider.md#serper
[Tavily]: ./docs/provider.md#tavily
[Valyu]: ./docs/provider.md#valyu
[You.com]: ./docs/provider.md#youcom

See the [provider guide](./docs/provider.md) for credentials, examples, and caveats.

## ⚙️ Configuration

Save choices with `web config default`, or edit YAML for more control:

```sh
web config path
web config show
web config validate
```

`show` hides credentials. `validate` checks your settings without making requests.
The default file is `~/.config/webfox/config.yaml`, respecting `XDG_CONFIG_HOME`
or, on Windows, `APPDATA`. Override it with `WEBFOX_CONFIG` or `--config <path>`.

For example:

```yaml
$schema: https://unpkg.com/webfox@latest/dist/config.schema.json
defaults:
  search:
    provider: brave
    maxResults: 5
  answer:
    provider: openai
providers:
  openai:
    options:
      answer:
        model: gpt-6-astra
```

Standard API key environment variables work without a credentials section. Run
`web providers <id>` to find the names for your provider. You can also read keys
from a password manager rather than store them in the file.

See the [example configuration](./example-config.yaml) and
[configuration reference](./docs/reference.md#configuration) for credential
commands, timeouts, retries, and provider defaults.

## 🤖 Use with Pi

Install the [Pi](https://pi.dev) extension:

```sh
pi install npm:webfox
```

To also use the `web` command in your terminal, follow [Installation](#-installation).
Both installations share the same Webfox configuration.

Add to `~/.config/webfox/config.yaml`:

```yaml
defaults:
  search:
    provider: brave
```

Start Pi with your API key:

```sh
export BRAVE_SEARCH_API_KEY=…
pi
```

Ask Pi: **Search the web for the latest Node.js release notes.**

Add `contents`, `answer`, or `research` defaults for more tools.
Restart Pi after changing defaults.

### Compose web calls with codemode

With Pi 0.99 or later, you can use its built-in `codemode` tool to chain web
calls, run independent calls in parallel, and filter results before they reach
the model. In `~/.pi/agent/settings.json` or your project's `.pi/settings.json`,
add:

```json
{
  "defaultTools": ["+codemode"]
}
```

This keeps your existing tools and adds codemode. Webfox tools remain directly
callable; you don't need an MCP server or another extension. In codemode, calls
such as `tools.web_search(...)` return structured result objects, not text.
Scripts receive complete results even when the direct tool output is truncated.
Only the output you emit with `text(...)` or `return` reaches the model.

Ask Pi: **Use codemode to search for Node.js and Bun cancellation, fetch up to
five unique pages, and return a short excerpt from each.** Pi can run a script
like this, provided you have configured both `search` and `contents` defaults:

```js
const search = await tools.web_search({
  queries: ["Node.js cancellation", "Bun cancellation"],
  maxResults: 3,
});

// Keep failed inputs visible while using the successful results.
for (const entry of search.results) {
  if (!entry.ok) text({ input: entry.input, error: entry.error });
}

const urls = [...new Set(
  search.results.flatMap(entry =>
    entry.ok ? entry.value.results.map(hit => hit.url) : []
  )
)].slice(0, 5);

if (!urls.length) exit();

const pages = await tools.web_contents({ urls });
text(pages.results.map(entry =>
  entry.ok
    ? { url: entry.value.url, excerpt: entry.value.content?.slice(0, 3000) }
    : { url: entry.input, error: entry.error }
));
```

For independent tasks, await every call with `Promise.allSettled`. This example
requires an `answer` default and keeps one rejected call from discarding the
other call's result:

```js
const answers = await Promise.allSettled([
  tools.web_answer({ queries: ["What is an AbortSignal?"] }),
  tools.web_answer({ queries: ["How does Bun handle cancellation?"] }),
]);

for (const answer of answers) {
  if (answer.status === "fulfilled") text(answer.value);
  else text({ error: String(answer.reason) });
}
```

A Webfox document with `status: "partial"` still resolves: check each result's
`ok` field before accessing `value`. Invalid arguments and blocked tool calls
reject instead. Nested calls still pass through Pi's validation and permission
hooks.

To return less data, select the fields you need rather than emit a whole
document. For example, this returns only titles and source URLs:

```js
const search = await tools.web_search({ queries: ["Node.js release notes"] });
text(search.results.flatMap(entry =>
  entry.ok
    ? entry.value.results.map(({ title, url }) => ({ title, url }))
    : [{ input: entry.input, error: entry.error }]
));
```

Webfox tools belong to the `web` namespace, which you can search from scripts
with `await searchTools("search", { namespace: "web" })`. To route all callable
tools through scripts, set `"codemode": { "mode": "only" }` in Pi's settings
alongside `defaultTools`. This setting affects all callable tools, not only
Webfox.

## 📚 Use with TypeScript

```ts
import { createWebfox } from "webfox";

const web = createWebfox();
const document = await web.search({
  provider: "brave",
  queries: ["Node.js AbortSignal"],
  maxResults: 5,
});

for (const result of document.results) {
  if (result.ok) console.log(result.value.results);
  else console.error(result.error.message);
}
```

The client also provides `contents`, `answer`, and `research`. See the
[library reference](./docs/reference.md#typescript-library) for request controls,
configuration, progress, and errors.

## 🩺 Troubleshooting

- **No provider selected:** Pass `--provider <id>` or save a default with
  `web config default <capability> <provider>`.
- **Missing credentials:** Run `web providers <id>` to check the required key
  names, or see the [provider guide](./docs/provider.md).
- **Invalid configuration in pi:** Pi continues to start, but Webfox registers
  no tools and reports the error (on stderr in print and JSON modes). Fix the
  configuration, then restart Pi or run `/reload` to load the extension again.
- **No pi tools:** Select default providers in the shared configuration and
  restart pi. Installing the extension or setting keys alone isn't enough.

## 📄 License

[MIT](LICENSE)

# Provider guide

Choose a provider for each capability, then supply its credentials. Save your
choices with `web config default`, or select a provider for one request with
`--provider`.

```sh
web providers
web providers brave
web search --provider brave --help
web config default search brave
```

`web providers <id>` shows setup guidance and supported capabilities. Configured
means local settings or credential sources exist—not that credentials or
connectivity have been verified. Inspection and help don't run credential commands
or make provider requests.

Use `web <capability> --provider <id> --help` for the full list of supported
options. To save options or read credentials from a password manager, see the
[configuration reference](./reference.md#configuration).

## Brave

Supports search, answers, and research. Set `BRAVE_SEARCH_API_KEY` for search and
`BRAVE_ANSWERS_API_KEY` for answers and research. The keys are separate; configuring
one doesn't configure the other capabilities.

```sh
web search "Node.js release notes" --provider brave
```

## Cloudflare

Supports page extraction through Cloudflare Browser Rendering. Set both
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

```sh
web contents https://example.com --provider cloudflare
```

## Custom

Connect your own command for any of the four capabilities. Configure
`providers.custom.commands.<capability>.argv`, optionally with `cwd` and
credential-source `env` entries. Only configured commands are available.

The process receives one JSON request:

```json
{
  "schemaVersion": 1,
  "capability": "search",
  "input": { "query": "example", "maxResults": 5 },
  "options": {},
  "cwd": "/working/directory"
}
```

Write one normalized result object to stdout and newline-delimited progress to
stderr. A nonzero exit signals failure. Contents answers must include a zero-based
`inputIndex` relative to the process request; `url` separately represents the final
URL. Errors are structured `{ "code": "PROVIDER_FAILURE", "message": "..." }`
objects. See the [custom-provider example](../examples/custom/README.md) for a
working command and the complete request/response contract.

## Exa

Supports search, page extraction, answers, and research. Set `EXA_API_KEY`.
Research returns a synthesized report with source links.

```sh
web search "Node.js release notes" --provider exa
web research "Compare databases for an analytics service" --provider exa --timeout 20m
```

## Firecrawl

Supports search, page extraction, and page-scoped answers. Set `FIRECRAWL_API_KEY`
for the hosted service. A self-hosted `providers.firecrawl.baseUrl` can work
without an API key.

Answers require a page URL, supplied through provider defaults or `--url`:

```sh
web contents https://example.com --provider firecrawl
web answer "What does this page explain?" --provider firecrawl --url https://example.com
```

## Gemini

Supports grounded answers and research, not standalone search. Set
`GOOGLE_API_KEY`. Google's Search tool runs inside a model interaction; Webfox
does not discard the generated answer and present its sources as ordinary search
results.

Answers default to `gemini-3.8-flash`. Override the model with
`providers.gemini.options.answer.model` or the answer command's `--model` flag.
Research uses `deep-research-preview-04-2026`, Google's standard
[Deep Research agent](https://ai.google.dev/gemini-api/docs/deep-research).
The research agent is fixed; answer model settings don't affect it.

If you previously selected Gemini for search, choose a search-capable provider
and remove `providers.gemini.options.search` from your configuration.

## Linkup

Supports search, page extraction, and research. Set `LINKUP_API_KEY`.

```sh
web search "Node.js release notes" --provider linkup
```

## Ollama

Supports search and page extraction through **hosted web APIs** at
`https://ollama.com`, not through the local Ollama model server. Set
`OLLAMA_API_KEY` from your Ollama account; no model download or local daemon is
required.

```sh
web search "Node.js streams documentation" --provider ollama --max-results 5
web contents https://example.com --provider ollama
```

Search supports up to 10 results. The `contents` capability uses Ollama's web
fetch endpoint. `providers.ollama.baseUrl` can point to a compatible proxy; it
does not turn the local inference API into a web search service.

## OpenAI

Supports search, grounded answers, and research. Set `OPENAI_API_KEY`.

```sh
web answer "What is MCP?" --provider openai --model gpt-6-astra
web search --provider openai --help
```

## Parallel

Supports search and page extraction. Set `PARALLEL_API_KEY`.

```sh
web search "Node.js release notes" --provider parallel
```

## Perplexity

Supports search, grounded answers, and research. Set `PERPLEXITY_API_KEY`.

```sh
web answer "What is MCP?" --provider perplexity
```

## SerpBase

Supports all six Google endpoints through the existing `search` capability and
Pi's `web_search` tool. Set `SERPBASE_API_KEY`, or configure
`providers.serpbase.credentials.api` with a credential source. No defaults change
unless you select SerpBase.

```sh
web search "Node.js release notes" --provider serpbase --gl us --hl en --device pc
web config default search serpbase
```

Choose a mode with `--mode` in the CLI or `options.mode` in the library and Pi:

| Mode | Input | Results and controls |
| --- | --- | --- |
| `search` (default) | Search text | Organic results; `device` is `default`, `pc`, or `mobile`. |
| `images` | Search text | Image URLs, source pages, and thumbnails. |
| `news` | Search text | Articles, publishers, and published-time text. |
| `videos` | Search text | Videos, sources, durations, and published-time text. |
| `maps` | Place search text | Places, addresses, ratings, and feature IDs; optional `lat`, `lng`, and `zoom`. |
| `maps-detail` | Feature IDs from `maps` | One place's details per input, including contact information and hours when available. |

Every mode accepts `hl` (language, default `en`) and `gl` (country, default `us`).
All modes except `maps-detail` accept `page` (1-based, default `1`). Maps Search
requires `lat` and `lng` together. `zoom` requires coordinates, ranges from `1` to
`21`, and defaults to `14` upstream when coordinates are supplied. Device
selection applies only to organic search; `default` lets SerpBase choose.

```sh
web search "architecture diagrams" --provider serpbase --mode images
web search "Node.js releases" --provider serpbase --mode news
web search "Node.js tutorials" --provider serpbase --mode videos
web search "coffee" --provider serpbase --mode maps --lat 52.52 --lng 13.405 --zoom 14
```

For place enrichment, copy a `feature_id` from a Maps result and pass it as the
search input. Don't use a place name, `place_id`, CID, or Maps URL:

```sh
web search '0x...:0x...' --provider serpbase --mode maps-detail
```

Replace the placeholder with an actual returned ID. The model follows the same
sequence using the same tool, with one feature ID per `queries` entry:

```json
{
  "queries": ["0x...:0x..."],
  "options": { "mode": "maps-detail" }
}
```

Save provider-specific defaults under `providers.serpbase.options.search`:

```yaml
providers:
  serpbase:
    options:
      search:
        gl: de
        hl: de
        device: pc
```

Changing modes drops incompatible inherited defaults. For example, a request
with `mode: images` doesn't inherit the configured `device: pc`. Explicitly
supplying incompatible options is an error, not a silently ignored setting.
Coordinate dependencies are checked after merging defaults and request options.

Each input fetches only the selected page or place, preserving result order.
`maxResults` trims that page locally; it doesn't increase the upstream page size
or fetch additional pages. Use `--page 2` to request another page explicitly.
Requests can incur charges, including retries after transient failures. See the
[SerpBase API reference](https://serpbase.dev/docs) for per-endpoint pricing.

Text and model-visible output include actionable fields: image/source URLs,
news/video sources and time text, and place feature IDs, addresses, contact
information, ratings, and hours when returned. Images aren't downloaded. Published
times and opening status are upstream observations, not independently verified.
Ambiguous clock-like video times are labeled `Time (upstream)`, not publication
dates or inferred durations. The known Google navigation-logo artifact is
excluded from image results; other results retain their upstream order.

JSON output retains original ranks, aliases, sitelinks, media fields, and place
data in `metadata`, alongside the selected `mode`. Ranks are page-relative, not
calculated absolute positions. `metadata.searchContext` includes the returned
page, query, request ID, charged credits, and rich SERP modules when available.
Context is attached to results, so an empty results list has no context metadata.
Rich modules aren't mixed into the primary result ordering.

The provider uses the JSON API directly, without an SDK dependency.
`providers.serpbase.baseUrl` can replace the API origin for a compatible proxy;
webfox appends the selected endpoint, such as `/google/images` or
`/google/maps/detail`.

## Serper

Supports search. Set `SERPER_API_KEY`.

```sh
web search "Node.js release notes" --provider serper
```

## You.com

Supports search. Set `YDC_API_KEY`; the library, CLI, and Pi extension use the
same credential. No defaults change unless you select You.com.

```sh
web search "Node.js release notes" --provider youcom \
  --freshness week --country US --language EN --include-domains nodejs.org
web config default search youcom
```

You.com returns separate web and news sections. Webfox alternates results from
these sections, starting with web and preserving each section's order, up to
`maxResults` (capped at 100 overall). If one section is exhausted, the other fills
the remaining slots. With `maxResults: 1`, web takes precedence. The `offset`
option selects pages from each section independently, using the capped
`maxResults` as the upstream page size.

Use `include_domains` to restrict sources, or combine `exclude_domains` with
`boost_domains` to exclude some sources and favor others. Don't combine
`include_domains` with either of the other domain lists. Each list supports up to
500 domains. Country and language codes use the API's uppercase spelling, such
as `US`, `EN`, and `EN-GB`. Run `web search --provider youcom --help` for supported
values and all native options.

Search snippets already contain query-relevant passages. For full page content,
enable live crawling:

```sh
web search "Node.js cancellation" --provider youcom \
  --livecrawl web --livecrawl-formats markdown --crawl-timeout 10 --format json
```

Live crawling adds latency and per-page charges, including pages that don't fit
within the final result limit. By default, it returns HTML; request `markdown` or
both formats as needed. Full content is preserved in each result's
`metadata.contents`; text output shows snippets rather than full pages. See
[You.com's API reference](https://you.com/docs/api-reference/search/v1-search-post)
for current pricing and filter behavior.

Provider-specific defaults belong under `providers.youcom.options.search`:

```yaml
defaults:
  search:
    provider: youcom
providers:
  youcom:
    options:
      search:
        country: US
        language: EN
        safesearch: moderate
```

`providers.youcom.baseUrl` optionally replaces the API origin for a proxy; webfox
appends `/v1/search`. Credential overrides use `providers.youcom.credentials.api`.
For example, `{env: MY_YOUCOM_KEY}` selects another environment variable.

The TypeScript library accepts the same native option names:

```ts
import { createWebfox } from "webfox";

const result = await createWebfox().search({
  provider: "youcom",
  queries: ["Node.js release notes"],
  maxResults: 5,
  options: { freshness: "week", include_domains: ["nodejs.org"] },
});
```

The provider uses the JSON POST API directly, like the HTTP-based Brave and
Serper providers. Option names follow the wire contract rather than the official
You.com SDK's camelCase names. Selecting You.com as the search default exposes
these options through the existing `web_search` Pi tool; no separate tool is
needed.

## Tavily

Supports search and page extraction. Set `TAVILY_API_KEY`.

```sh
web contents https://example.com --provider tavily
```

## Valyu

Supports search, page extraction, answers, and research. Set `VALYU_API_KEY`.

```sh
web search "Node.js release notes" --provider valyu
```

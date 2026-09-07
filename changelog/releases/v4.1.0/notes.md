Search the web and news with You.com from the CLI, TypeScript library, and Pi extension. Filter or boost domains and optionally retrieve full page content with live crawling, without changing your existing provider defaults.

## 🚀 Features

### You.com web and news search

You can now use You.com for web and news search from the CLI, TypeScript library, and Pi extension. Set `YDC_API_KEY` and select the provider:

```sh
web search "Node.js release notes" --provider youcom --freshness week
```

Results alternate between web and news within the requested result limit. Provider options support domain filtering and boosting, country and language selection, pagination, and optional live crawling for full HTML or Markdown content. Live crawling adds latency and per-page charges. Existing provider defaults remain unchanged.

*By @mouse-value-add in #40.*

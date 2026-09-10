---
title: SerpBase Google search provider
type: feature
authors:
  - mavam
prs:
  - 46
created: 2026-09-10T08:18:46.12072Z
---

You can now use your SerpBase API key for Google organic searches in the CLI,
TypeScript library, and Pi extension. Set `SERPBASE_API_KEY` or configure
`providers.serpbase.credentials.api`, then select the provider:

```sh
web search "Node.js release notes" --provider serpbase --gl us --hl en --device pc
web config default search serpbase
```

Choose a country, language, device, and results page without changing your search
workflow. Each query fetches one page and preserves its organic ordering, with
ranks and available SERP context retained in JSON metadata. `maxResults` limits
that page locally; it doesn't trigger additional billed pages.

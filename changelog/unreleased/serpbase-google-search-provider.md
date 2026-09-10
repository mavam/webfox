---
title: SerpBase Google search provider
type: feature
authors:
  - mavam
prs:
  - 46
created: 2026-09-10T11:25:30.364726Z
---

You can now use your SerpBase API key for Google search, images, news, videos,
Maps Search, and place details through the existing CLI, TypeScript library, and
Pi `web_search` tool. Set `SERPBASE_API_KEY` or configure
`providers.serpbase.credentials.api`, then select a search mode:

```sh
web search "Node.js release notes" --provider serpbase --mode news
web search "coffee in Berlin" --provider serpbase --mode maps
web config default search serpbase
```

For place details, pass a `feature_id` returned by Maps Search as the search input
with `--mode maps-detail`. In Pi, put these IDs in `queries`; no additional tool
is needed. Model-visible output includes feature IDs, contact information, and
media URLs so follow-up calls don't depend on hidden metadata.

Choose a country, language, device, page, or map center as supported by the
selected mode. Mode changes drop incompatible inherited defaults; explicitly
incompatible options are rejected. Each input fetches one page or place and
preserves result order, with original ranks and available context retained in
JSON metadata. `maxResults` limits the result locally and doesn't trigger
additional billed pages.

SerpBase requests have a 120-second overall deadline by default to accommodate
slower endpoints. Explicit request or execution timeouts still take precedence;
other providers keep their existing defaults.

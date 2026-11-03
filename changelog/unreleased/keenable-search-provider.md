---
title: Keenable search provider
type: feature
authors:
  - KGKallasmaa
created: 2026-11-03T20:00:00.000000Z
---

You can now use a Keenable API key for web search through the existing CLI,
TypeScript library, and Pi `web_search` tool. Set `KEENABLE_API_KEY` or configure
`providers.keenable.credentials.api`, then select it:

```sh
web search "Node.js release notes" --provider keenable --site nodejs.org
web config default search keenable
```

Keenable searches can filter by site and by publication or indexing time, and
can trade retrieval depth for latency with `mode: "realtime"`.

No defaults change unless you select Keenable.

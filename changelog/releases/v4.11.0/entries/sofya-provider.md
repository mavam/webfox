---
title: Sofya provider
type: feature
authors:
  - yusufgurdogan
created: 2026-11-05T12:00:00.000000Z
---

You can now use a Sofya API key for search, page contents, answers, and
research through the existing CLI, TypeScript library, and Pi tools. Set
`SOFYA_API_KEY` or configure `providers.sofya.credentials.api`, then select it:

```sh
web search "Node.js release notes" --provider sofya --freshness month
web config default search sofya
```

Sofya searches can filter by topic, freshness, and domain. No defaults change
unless you select Sofya.

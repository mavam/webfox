---
title: New Tavily and Valyu provider options
type: feature
authors:
  - mavam
prs:
  - 63
created: 2026-11-22T20:09:17.375913Z
---

The Tavily and Valyu providers now expose the latest options from their updated SDKs across the CLI, configuration schema, TypeScript library, and Pi tools:

- **Tavily search and contents**: `includeImageDescriptions`, `includeDomainsMode` (`restrict` or `prefer`), `maxAgeHours`, `fetchTimeout`, `cacheFallback`, `language`, `filterByLanguage`, `safeSearch`, `includePublishedDate`, `filterByPublishedDate`, and `includeUsage`. Credit usage returned by Tavily is now preserved in result metadata.
- **Valyu research**: `mode: "instant"`, `outputFormats: ["structured_report"]`, and `skills`. Valyu has deprecated its Answer API (retiring 2026-12-17); use `research` with `--mode instant` or `search` for new workflows.

```sh
web search "Node.js release notes" --provider tavily --safe-search --include-usage
web research "Compare Node.js and Bun" --provider valyu --mode instant
```

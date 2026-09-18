---
title: Historical page versions with Exa Snapshot
type: feature
authors:
  - mavam
prs:
  - 52
created: 2026-09-18T07:25:40.217486Z
---

You can now retrieve historical page versions with Exa Snapshot in search and page extraction. The options and usage guidance are also available to models when Exa is selected in pi.

For search, put the cutoff inside `contents`:

```sh
web search "Python release notes" --provider exa \
  --options-json '{"contents":{"snapshotAsOf":"2026-07-01T00:00:00Z"}}'
```

For page extraction, use `--options-json '{"snapshotAsOf":"2026-07-01T00:00:00Z","text":true}'`. Exa returns the newest stored page version at or before the cutoff. Snapshot search supports `auto`, `fast`, and `instant` without `category`; omit live-fetch and subpage controls. Access and lookback are limited during the research preview.

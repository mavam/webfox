---
title: Stable configuration schema URLs
type: change
authors:
  - mavam
prs:
  - 41
created: 2026-09-08T04:53:09.601303Z
---

Configuration schema URLs now follow the latest published release, so examples no longer need URL updates after every release:

```yaml
$schema: https://unpkg.com/webfox@latest/dist/config.schema.json
```

Editor validation follows the latest schema even when an older Webfox version is installed. Replace `latest` with an exact version if you need validation pinned to that release.

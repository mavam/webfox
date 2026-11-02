This release removes webfox's dependency on zod 3.x, clearing the high-severity npm audit advisory GHSA-mrhx-c7xc-m3w5 reported in #59. The Exa, Firecrawl, and Linkup providers now call their APIs directly, remaining provider SDKs are up to date, and Valyu reports missing pages as errors.

## 🔧 Changes

### Document Parallel search and extraction controls

The Parallel provider guide now shows how to select Fast mode, restrict search sources, save provider options, and request full pages or focused excerpts.

## 🐞 Bug fixes

### Remove vulnerable zod 3 dependency

Installing webfox no longer pulls in zod 3.x, so `npm audit` no longer reports the high-severity zod advisory GHSA-mrhx-c7xc-m3w5. The Exa, Firecrawl, and Linkup providers now call their HTTP APIs directly instead of through provider SDKs that pinned the vulnerable zod release line. Provider options and results stay the same, and cancellation now aborts in-flight requests to these providers.

The Firecrawl provider no longer reads the `FIRECRAWL_API_URL` environment variable, which the Firecrawl SDK honored implicitly. If you point webfox at a self-hosted Firecrawl instance through that variable, set `providers.firecrawl.baseUrl` instead; otherwise requests go to the Firecrawl cloud API.

*By @mavam.*

### Report missing Valyu pages as errors

Valyu page extraction now reports pages that Valyu cannot find as per-URL errors. Previously, these pages appeared as successful results without content.

*By @mavam in #60.*

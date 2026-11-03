Search with Keenable using site and time filters, or enable realtime mode for fresh results.

## 🚀 Features

### Keenable search provider

You can now use a Keenable API key for web search through the existing CLI, TypeScript library, and Pi `web_search` tool. Set `KEENABLE_API_KEY` or configure `providers.keenable.credentials.api`, then select it:

```sh
web search "Node.js release notes" --provider keenable --site nodejs.org
web config default search keenable
```

Keenable searches can filter by site and by publication or indexing time, and can trade retrieval depth for latency with `mode: "realtime"`.

No defaults change unless you select Keenable.

*By @KGKallasmaa.*

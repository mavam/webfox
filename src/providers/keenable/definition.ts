import { defineProvider } from "../definition.js";

// Wire names follow the POST Search API:
// https://docs.keenable.ai/api-reference/search
const timeFilter = (description: string) => ({
  type: "string",
  minLength: 1,
  description: `${description} Accepts YYYY-MM-DD, an ISO 8601 timestamp, or a relative delta such as 7d, 12h, or 30min.`,
});

export const keenableProvider = defineProvider({
  id: "keenable",
  label: "Keenable",
  docsUrl: "https://docs.keenable.ai/api-reference/search",
  local: false,
  credentials: [{ name: "api", environmentVariable: "KEENABLE_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["pro", "realtime"],
            description:
              "Search mode: 'pro' (default) for deeper retrieval, 'realtime' for the fastest results. Each mode is billed separately.",
          },
          site: {
            type: "string",
            minLength: 1,
            description: "Restrict results to one site, e.g. 'techcrunch.com'.",
          },
          published_after: timeFilter(
            "Only pages published at or after this time.",
          ),
          published_before: timeFilter(
            "Only pages published at or before this time.",
          ),
          acquired_after: timeFilter(
            "Only pages indexed at or after this time.",
          ),
          acquired_before: timeFilter(
            "Only pages indexed at or before this time.",
          ),
          query_time: {
            type: "string",
            minLength: 1,
            description:
              "Search the index as it stood at this date or ISO 8601 timestamp; relative time filters resolve against it.",
          },
          snippet_max_length: {
            type: "integer",
            minimum: 180,
            maximum: 10000,
            description: "Maximum characters of the excerpt per result.",
          },
        },
        description: "Keenable search options.",
      },
      promptGuidelines: [
        "Keenable returns ranked web results with page excerpts; use web_contents to read selected sources in full.",
        "Use Keenable site to restrict results to one domain, and published_after/published_before (e.g. '7d') for recent or date-bounded results.",
        "Use Keenable mode='realtime' only when latency matters more than retrieval depth.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

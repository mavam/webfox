import { defineProvider } from "../definition.js";

// Wire names follow the REST API: https://sofya.co/docs
const filters = {
  topic: {
    type: "string",
    enum: ["general", "news"],
    description:
      "'news' for news articles, 'general' (default) for web search.",
  },
  freshness: {
    type: "string",
    pattern:
      "^(day|week|month|year|\\d{4}-\\d{2}-\\d{2}:\\d{4}-\\d{2}-\\d{2})$",
    description:
      "Recency filter: day, week, month, year, or a YYYY-MM-DD:YYYY-MM-DD range.",
  },
};
const domainFilters = {
  include_domains: {
    type: "array",
    items: { type: "string", minLength: 1 },
    maxItems: 10,
    description: "Only return results from these domains, e.g. 'github.com'.",
  },
  exclude_domains: {
    type: "array",
    items: { type: "string", minLength: 1 },
    maxItems: 10,
    description: "Exclude results from these domains.",
  },
};
const searchDepth = {
  type: "string",
  enum: ["snippets", "basic"],
  description:
    "'snippets' (1 credit) returns search snippets; 'basic' (2 credits) also reads each page and returns its text in metadata.content.",
};

export const sofyaProvider = defineProvider({
  id: "sofya",
  label: "Sofya",
  docsUrl: "https://sofya.co/docs",
  local: false,
  credentials: [{ name: "api", environmentVariable: "SOFYA_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: { search: { search_depth: "snippets" } },
  credentialDefaults: {},
  capabilities: {
    search: {
      // Sofya calls can take up to 60 seconds; allow headroom.
      defaultTimeoutMs: 90_000,
      options: {
        type: "object",
        properties: {
          search_depth: searchDepth,
          ...filters,
          ...domainFilters,
        },
        description: "Sofya search options.",
      },
      promptGuidelines: [
        "Sofya search returns ranked results with snippets; use web_contents to read selected sources in full.",
        "Use Sofya topic='news' and freshness (e.g. 'week') for recent events, and include_domains to restrict results to specific sites.",
      ],
      retrySafe: true,
    },
    contents: {
      defaultTimeoutMs: 90_000,
      options: {
        type: "object",
        properties: {
          include_raw_html: {
            type: "boolean",
            description: "Include the raw HTML source in metadata.raw_html.",
          },
        },
        description: "Sofya contents options.",
      },
      retrySafe: true,
    },
    answer: {
      defaultTimeoutMs: 90_000,
      options: {
        type: "object",
        properties: {
          search_depth: searchDepth,
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Search results the answer is grounded in.",
          },
          ...filters,
          ...domainFilters,
        },
        description: "Sofya answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          ...filters,
          max_sources: {
            type: "integer",
            minimum: 5,
            maximum: 30,
            description: "Maximum sources to read (default 20).",
          },
        },
        description: "Sofya research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

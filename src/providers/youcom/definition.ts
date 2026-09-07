import { defineProvider } from "../definition.js";

const extraction = {
  type: "object",
  properties: {
    extraction_mode: {
      type: "string",
      enum: ["highlights", "full_page"],
      description:
        "Request query-aware highlights or full-page content for each result.",
    },
    crawl_timeout: {
      type: "integer",
      minimum: 1,
      maximum: 60,
      description: "Seconds to wait while crawling pages for extraction.",
    },
  },
  description:
    "Optional extraction controls for the You.com Search API POST endpoint.",
};

const domains = {
  type: "array",
  items: { type: "string" },
};

export const youcomProvider = defineProvider({
  id: "youcom",
  label: "You.com",
  docsUrl: "https://you.com/docs/api-reference/search/v1-search",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "YDC_API_KEY",
      capabilities: ["search"],
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          freshness: {
            type: "string",
            description:
              "Freshness window such as day, week, month, year, or a YYYY-MM-DDtoYYYY-MM-DD range.",
          },
          country: {
            type: "string",
            description:
              "Country code used to localize search results, for example US.",
          },
          language: {
            type: "string",
            description:
              "Language for the returned web results, for example en.",
          },
          safesearch: {
            type: "string",
            enum: ["moderate", "off", "strict"],
            description: "Safe-search filtering level.",
          },
          knowledge: {
            type: "boolean",
            description:
              "Include knowledge results alongside web and news results.",
          },
          offset: {
            type: "integer",
            minimum: 0,
            maximum: 9,
            description:
              "Pagination offset. Results are returned in count-sized pages.",
          },
          include_domains: {
            ...domains,
            description:
              "Allowlist of domains to return from You.com search results.",
          },
          exclude_domains: {
            ...domains,
            description:
              "Blocklist of domains to exclude from You.com search results.",
          },
          boost_domains: {
            ...domains,
            description:
              "Domains to boost in ranking without filtering out other results.",
          },
          extraction,
        },
        description: "You.com search options.",
      },
      promptGuidelines: [
        "Use You.com search for fresh web and news results when the task benefits from a structured search API.",
        "Use include_domains or exclude_domains when the user wants to focus on a known source set.",
        "Use extraction_mode: highlights when the task needs query-aware passages for RAG or retrieval loops.",
        "Use extraction_mode: full_page only when the caller needs the underlying page content in the search response.",
        "Favor You.com when the workflow needs a search provider that can surface both web and news results from one request.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

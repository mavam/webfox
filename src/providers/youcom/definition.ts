import { defineProvider } from "../definition.js";

// Wire names and enums follow the POST Search API, not SDK camelCase names:
// https://you.com/docs/api-reference/search/v1-search-post.md
const domains = {
  type: "array",
  maxItems: 500,
  items: { type: "string", minLength: 1 },
};

export const youcomProvider = defineProvider({
  id: "youcom",
  label: "You.com",
  docsUrl: "https://you.com/docs/api-reference/search/v1-search-post",
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
              "Freshness window: day, week, month, year, or YYYY-MM-DDtoYYYY-MM-DD. You.com uses the broader timeframe when the query also specifies one.",
          },
          country: {
            type: "string",
            enum: [
              "AR",
              "AU",
              "AT",
              "BE",
              "BR",
              "CA",
              "CL",
              "DK",
              "FI",
              "FR",
              "DE",
              "HK",
              "IN",
              "ID",
              "IT",
              "JP",
              "KR",
              "MY",
              "MX",
              "NL",
              "NZ",
              "NO",
              "CN",
              "PL",
              "PT",
              "PH",
              "RU",
              "SA",
              "ZA",
              "ES",
              "SE",
              "CH",
              "TW",
              "TR",
              "GB",
              "US",
            ],
            description:
              "Country code used to localize search results, for example US.",
          },
          language: {
            type: "string",
            enum: [
              "AR",
              "EU",
              "BN",
              "BG",
              "CA",
              "ZH-HANS",
              "ZH-HANT",
              "HR",
              "CS",
              "DA",
              "NL",
              "EN",
              "EN-GB",
              "ET",
              "FI",
              "FR",
              "GL",
              "DE",
              "EL",
              "GU",
              "HE",
              "HI",
              "HU",
              "IS",
              "IT",
              "JA",
              "KN",
              "KO",
              "LV",
              "LT",
              "MS",
              "ML",
              "MR",
              "NB",
              "PL",
              "PT-BR",
              "PT-PT",
              "PA",
              "RO",
              "RU",
              "SR",
              "SK",
              "SL",
              "ES",
              "SV",
              "TA",
              "TE",
              "TH",
              "TR",
              "UK",
              "VI",
            ],
            description:
              "Language of web results. Uses You.com's uppercase codes; defaults to EN.",
          },
          safesearch: {
            type: "string",
            enum: ["moderate", "off", "strict"],
            description: "Safe-search filtering level. Defaults to moderate.",
          },
          offset: {
            type: "integer",
            minimum: 0,
            maximum: 9,
            description:
              "Pagination offset in count-sized pages, separately for web and news. Count is maxResults capped at 100.",
          },
          include_domains: {
            ...domains,
            description:
              "Restrict results to these domains. Cannot be combined with exclude_domains or boost_domains.",
          },
          exclude_domains: {
            ...domains,
            description:
              "Exclude these domains. Cannot be combined with include_domains.",
          },
          boost_domains: {
            ...domains,
            description:
              "Boost these domains without excluding others. Can be combined with exclude_domains, but not include_domains.",
          },
          livecrawl: {
            type: "string",
            enum: ["web", "news", "all"],
            description:
              "Fetch full page content for the selected sections. Adds latency and per-page charges, including results omitted by maxResults. Content is preserved in result metadata.contents.",
          },
          livecrawl_formats: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { type: "string", enum: ["html", "markdown"] },
            description:
              "Formats for livecrawled content. Defaults to html; requires livecrawl to enable crawling.",
          },
          crawl_timeout: {
            type: "integer",
            minimum: 1,
            maximum: 60,
            description:
              "Seconds to wait for page content when livecrawl is enabled. Defaults to 10.",
          },
        },
        // Property prohibitions also work for partial configured defaults:
        // unlike required-based exclusions, they survive partial validation.
        anyOf: [
          { properties: { include_domains: false } },
          { properties: { exclude_domains: false, boost_domains: false } },
        ],
        description:
          "You.com search options. Results alternate web and news, starting with web, up to maxResults (capped at 100).",
      },
      promptGuidelines: [
        "Use You.com search for web and news results. Results alternate web and news, starting with web, within the overall result limit.",
        "Use include_domains to restrict sources, or exclude_domains and boost_domains to adjust source selection. Do not combine include_domains with either of the other domain controls.",
        "Search snippets already contain query-relevant passages. Enable livecrawl only when full page content is needed; it adds latency and per-page charges.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

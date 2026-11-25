import { expect, it } from "vitest";
import type { Capability, ProviderId } from "../src/domain.js";
import { providers } from "../src/providers/registry.js";
import { validateOptions } from "../src/configuration/planning.js";

// Runtime checks validate representative provider-native option payloads
// against the schemas exposed to CLI, library, and Pi callers.
const samples: Array<{
  provider: ProviderId;
  capability: Capability;
  options: Record<string, unknown>;
}> = [
  {
    provider: "gemini",
    capability: "answer",
    options: {
      config: {
        thinkingConfig: { thinkingLevel: "HIGH" },
        maxOutputTokens: 1024,
      },
    },
  },
  {
    provider: "firecrawl",
    capability: "search",
    options: {
      location: "Berlin, Germany",
      sources: ["web"],
      categories: ["developer"],
      scrapeOptions: {
        location: { country: "DE", languages: ["de"] },
        waitFor: 100,
      },
    },
  },
  {
    provider: "firecrawl",
    capability: "contents",
    options: {
      location: { country: "US", languages: ["en"] },
      redactPII: { mode: "fast", entities: ["EMAIL"] },
    },
  },
  {
    provider: "tavily",
    capability: "search",
    options: {
      searchDepth: "ultra-fast",
      includeAnswer: "advanced",
      includeRawContent: "markdown",
      includeImageDescriptions: true,
      includeDomainsMode: "prefer",
      maxAgeHours: 24,
      fetchTimeout: 10,
      cacheFallback: true,
      language: "en",
      filterByLanguage: true,
      safeSearch: true,
      includePublishedDate: true,
      filterByPublishedDate: true,
      includeUsage: true,
      timeRange: "week",
    },
  },
  {
    provider: "tavily",
    capability: "contents",
    options: {
      extractDepth: "advanced",
      query: "release dates",
      chunksPerSource: 3,
      includeUsage: true,
      timeout: 30,
    },
  },
  {
    provider: "parallel",
    capability: "search",
    options: {
      mode: "fast",
      objective: "Find official docs",
      advanced_settings: {
        source_policy: { include_domains: ["example.com"] },
        fetch_policy: { max_age_seconds: 600 },
        excerpt_settings: { max_chars_per_result: 2000 },
      },
    },
  },
  {
    provider: "cloudflare",
    capability: "contents",
    options: {
      gotoOptions: { timeout: 10000, waitUntil: "domcontentloaded" },
      waitForSelector: { selector: "main", visible: true },
    },
  },
  {
    provider: "perplexity",
    capability: "research",
    options: {
      model: "sonar-deep-research",
      reasoning_effort: "high",
      max_tokens: 2000,
      search_mode: "academic",
      web_search_options: { search_context_size: "high" },
    },
  },
  {
    provider: "linkup",
    capability: "contents",
    options: {
      mode: "pro",
      includeRawContent: true,
      extractImages: true,
    },
  },
  {
    provider: "valyu",
    capability: "research",
    options: {
      mode: "instant",
      outputFormats: ["markdown", "structured_report"],
      skills: ["forecasting"],
      tools: {
        browser_use: { enabled: true, max_calls: 3 },
        screenshots: false,
      },
    },
  },
  {
    provider: "serpbase",
    capability: "search",
    options: { hl: "en", gl: "us", page: 2, device: "mobile" },
  },
  {
    provider: "youcom",
    capability: "search",
    options: {
      freshness: "week",
      country: "US",
      language: "EN",
      safesearch: "moderate",
      include_domains: ["example.com"],
      livecrawl: "web",
      livecrawl_formats: ["markdown"],
      crawl_timeout: 10,
    },
  },
  {
    provider: "keenable",
    capability: "search",
    options: {
      mode: "realtime",
      site: "nodejs.org",
      published_after: "7d",
      acquired_before: "2026-01-15",
      query_time: "2026-01-16T00:00:00Z",
      snippet_max_length: 500,
    },
  },
  {
    provider: "sofya",
    capability: "search",
    options: {
      search_depth: "basic",
      topic: "news",
      freshness: "2026-01-01:2026-02-01",
      include_domains: ["nodejs.org"],
    },
  },
  {
    provider: "sofya",
    capability: "research",
    options: { topic: "general", freshness: "month", max_sources: 10 },
  },
];

it.each(samples)(
  "accepts provider-native $provider $capability controls",
  ({ provider, capability, options }) => {
    expect(() =>
      validateOptions(providers[provider], capability, options),
    ).not.toThrow();
  },
);

it("isolates provider schemas and keeps host-managed controls unavailable", () => {
  for (const definition of Object.values(providers)) {
    if (definition.id === "custom") continue;
    for (const capability of Object.keys(
      definition.capabilities,
    ) as Capability[]) {
      expect(() =>
        validateOptions(definition, capability, {
          commands: { search: "malicious" },
        }),
      ).toThrow();
      expect(() =>
        validateOptions(definition, capability, {
          unknownProviderControl: true,
        }),
      ).toThrow();
    }
  }
});

it.each([
  ["firecrawl", "search", { location: { country: "US" } }],
  ["firecrawl", "contents", { location: { city: "Boston" } }],
  ["tavily", "contents", { extractDepth: "deep" }],
  ["keenable", "search", { mode: "invented" }],
  ["keenable", "search", { snippet_max_length: 100 }],
  ["sofya", "search", { freshness: "last week" }],
  ["sofya", "research", { max_sources: 50 }],
  ["perplexity", "search", { search_mode: "invented" }],
  ["openai", "research", { userLocation: { country: "US" } }],
  ["valyu", "research", { tools: { browser_use: { arbitrarySetting: true } } }],
] as const)(
  "rejects invalid %s %s combinations",
  (provider, capability, options) => {
    expect(() =>
      validateOptions(providers[provider], capability, options),
    ).toThrow();
  },
);

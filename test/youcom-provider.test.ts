import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox, validateConfiguredOptions } from "../src/index.js";
import { validateOptions } from "../src/configuration/planning.js";
import { configurationSchema } from "../src/configuration/schema.js";
import { Check } from "typebox/value";
import { adapter } from "../src/providers/youcom/adapter.js";
import { youcomProvider } from "../src/providers/youcom/definition.js";

// Wire fixture follows https://you.com/docs/api-reference/search/v1-search-post.md.
const web = {
  url: "https://example.com/web",
  title: "Web result",
  description: "Web description",
  snippets: ["First passage", "Second passage"],
  favicon_url: "https://example.com/favicon.ico",
  contents: { markdown: "# Full page\n\nContent", html: "<h1>Full page</h1>" },
};
const news = {
  url: "https://example.com/news",
  title: "News result",
  description: "News description",
  page_age: "2025-11-25T12:31:29",
  thumbnail_url: "https://example.com/news.png",
};
const metadata = { query: "example", search_uuid: "uuid-123", latency: 0.23 };
const payload = { results: { web: [web], news: [news] }, metadata };

function mockResponse(body: unknown = payload, status = 200) {
  return vi
    .fn()
    .mockImplementation(async () => Response.json(body, { status }));
}
function client(options: Record<string, unknown> = {}) {
  return createWebfox({
    config: {
      defaults: { search: { provider: "youcom" } },
      execution: { retries: 0 },
      providers: { youcom: { options: { search: options } } },
    },
    env: { YDC_API_KEY: "test-key" },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("You.com search", () => {
  it("exposes credentials, capabilities, and native option schemas without initializing transport", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(client().getProvider("youcom")).toMatchObject({
      capabilities: ["search"],
      configured: ["search"],
      selectedDefaults: ["search"],
      credentials: [
        {
          name: "api",
          environmentVariable: "YDC_API_KEY",
          capabilities: ["search"],
        },
      ],
    });
    const schema = client().inspectCapability("search").optionSchema!;
    expect(schema.properties).toHaveProperty("livecrawl");
    expect(schema.properties).not.toHaveProperty("extraction");
    expect(schema.additionalProperties).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps the POST contract, configured defaults, request overrides, and extracted metadata", async () => {
    const fetch = mockResponse();
    vi.stubGlobal("fetch", fetch);
    const result = await client({
      country: "US",
      language: "EN",
      freshness: "month",
    }).search({
      queries: ["example"],
      maxResults: 7,
      options: {
        freshness: "week",
        safesearch: "strict",
        offset: 2,
        include_domains: ["example.com"],
        livecrawl: "all",
        livecrawl_formats: ["markdown", "html"],
        crawl_timeout: 15,
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://ydc-index.io/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "X-API-Key": "test-key",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      query: "example",
      count: 7,
      country: "US",
      language: "EN",
      freshness: "week",
      safesearch: "strict",
      offset: 2,
      include_domains: ["example.com"],
      livecrawl: "all",
      livecrawl_formats: ["markdown", "html"],
      crawl_timeout: 15,
    });
    expect(result.status).toBe("ok");
    expect(result.results[0]).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            title: web.title,
            url: web.url,
            snippet: "First passage Second passage",
            metadata: { ...web, section: "web", searchMetadata: metadata },
          },
          {
            title: news.title,
            url: news.url,
            snippet: news.description,
            metadata: { ...news, section: "news", searchMetadata: metadata },
          },
        ],
      },
    });
  });

  it.each([
    [5, 5, 5, ["web", "news", "web", "news", "web"]],
    [5, 1, 5, ["web", "news", "web", "web", "web"]],
    [0, 3, 5, ["news", "news", "news"]],
    [3, 0, 5, ["web", "web", "web"]],
    [0, 0, 5, []],
    [3, 3, 1, ["web"]],
  ])(
    "interleaves %i web and %i news results within limit %i",
    async (webCount, newsCount, maxResults, sections) => {
      vi.stubGlobal(
        "fetch",
        mockResponse({
          results: {
            web: Array.from({ length: webCount }, (_, i) => ({
              ...web,
              title: `Web ${i}`,
            })),
            news: Array.from({ length: newsCount }, (_, i) => ({
              ...news,
              title: `News ${i}`,
            })),
          },
        }),
      );
      const result = await adapter.search(
        { capability: "search", query: "example", maxResults },
        { credentials: { api: "test-key" } },
        { cwd: process.cwd() },
      );
      expect(result.results.map((entry) => entry.metadata?.section)).toEqual(
        sections,
      );
      expect(
        result.results
          .filter((entry) => entry.metadata?.section === "web")
          .map((entry) => entry.title),
      ).toEqual(
        Array.from(
          { length: sections.filter((s) => s === "web").length },
          (_, i) => `Web ${i}`,
        ),
      );
    },
  );

  it("caps the per-section count and final result count at 100", async () => {
    const fetch = mockResponse({
      results: { web: Array(100).fill(web), news: Array(100).fill(news) },
    });
    vi.stubGlobal("fetch", fetch);
    const result = await adapter.search(
      { capability: "search", query: "example", maxResults: 150 },
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).count).toBe(100);
    expect(result.results).toHaveLength(100);
    expect(
      result.results.filter((entry) => entry.metadata?.section === "news"),
    ).toHaveLength(50);
  });

  it("supports a custom endpoint and propagates cancellation", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = adapter.search(
      { capability: "search", query: "example", maxResults: 5 },
      {
        baseUrl: "https://proxy.example.com///",
        credentials: { api: "test-key" },
      },
      { cwd: process.cwd(), signal: controller.signal },
    );
    expect(fetch.mock.calls[0][0]).toBe("https://proxy.example.com/v1/search");
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([401, 422, 429, 503])(
    "classifies and redacts HTTP %i failures",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        mockResponse({ detail: "request failed for test-key" }, status),
      );
      const result = await client().search({ queries: ["example"] });
      expect(result.status).toBe("partial");
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: {
          code: "PROVIDER_FAILURE",
          retryable: status === 429 || status >= 500,
        },
      });
      expect(JSON.stringify(result)).not.toContain("test-key");
      expect(JSON.stringify(result)).toContain(String(status));
    },
  );

  it("rejects missing credentials without making requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      createWebfox({ config: {}, env: {} }).search({
        provider: "youcom",
        queries: ["example"],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { include_domains: ["example.com"], exclude_domains: ["news.example.com"] },
    { include_domains: ["example.com"], boost_domains: ["news.example.com"] },
    { include_domains: [], exclude_domains: [] },
    { include_domains: Array(501).fill("example.com") },
    { include_domains: [""] },
    { language: "en" },
    { country: "ZZ" },
    { offset: 10 },
    { livecrawl: "invalid" },
    { livecrawl_formats: ["text"] },
    { livecrawl_formats: [] },
    { crawl_timeout: 0 },
    { crawl_timeout: 61 },
    { knowledge: true },
    { extraction: { extraction_mode: "highlights" } },
  ])(
    "rejects invalid native options across schemas and execution: %j",
    async (options) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(() =>
        validateOptions(youcomProvider, "search", options),
      ).toThrow();
      const config = {
        providers: { youcom: { options: { search: options } } },
      };
      expect(() => validateConfiguredOptions(config)).toThrow();
      expect(Check(configurationSchema, config)).toBe(false);
      await expect(
        client().search({ queries: ["example"], options }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects domain conflicts after merging defaults and overrides", async () => {
    await expect(
      client({ include_domains: ["example.com"] }).search({
        queries: ["example"],
        options: { boost_domains: ["news.example.com"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("accepts and forwards exclusion plus boosting and 500-domain allowlists", async () => {
    const fetch = mockResponse();
    vi.stubGlobal("fetch", fetch);
    for (const options of [
      { exclude_domains: ["spam.example.com"], boost_domains: ["example.com"] },
      { include_domains: Array(500).fill("example.com") },
    ]) {
      const config = {
        providers: { youcom: { options: { search: options } } },
      };
      expect(() => validateConfiguredOptions(config)).not.toThrow();
      expect(Check(configurationSchema, config)).toBe(true);
      expect(
        (await client().search({ queries: ["example"], options })).status,
      ).toBe("ok");
      expect(JSON.parse(fetch.mock.lastCall![1].body)).toMatchObject(options);
    }
  });
});

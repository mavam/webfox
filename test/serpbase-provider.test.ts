import { afterEach, describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { createWebfox, validateConfiguredOptions } from "../src/index.js";
import { validateOptions } from "../src/configuration/planning.js";
import { configurationSchema } from "../src/configuration/schema.js";
import { adapter } from "../src/providers/serpbase/adapter.js";
import { serpbaseProvider } from "../src/providers/serpbase/definition.js";

// Wire contract: https://serpbase.dev/docs, including the business-status envelope.
const organic = {
  rank: 1,
  position: 1,
  title: "Node.js",
  link: "https://nodejs.org/api/globals.html",
  url: "https://nodejs.org/alias",
  snippet: "AbortSignal\n documentation",
  sitelinks: [{ title: "API", link: "https://nodejs.org/api/" }],
};
const context = {
  status: 0,
  query: "Node.js AbortSignal",
  page: 2,
  request_id: "request-123",
  elapsed_ms: 123,
  credits_charged: 1,
  search_type: "search",
  people_also_ask: [{ question: "What is AbortSignal?" }],
  related_searches: ["Node.js cancellation"],
  featured_snippet: { answer: "A cancellation signal" },
};
const payload = { ...context, organic: [organic] };
function mockResponse(body: unknown = payload, status = 200) {
  return vi
    .fn()
    .mockImplementation(async () => Response.json(body, { status }));
}
function client(options: Record<string, unknown> = {}, retries = 0) {
  return createWebfox({
    config: {
      defaults: { search: { provider: "serpbase" } },
      execution: { retries, retryDelayMs: 0 },
      providers: { serpbase: { options: { search: options } } },
    },
    env: { SERPBASE_API_KEY: "test-key" },
  });
}
const request = {
  capability: "search",
  query: "example",
  maxResults: 5,
} as const;
const config = { credentials: { api: "test-key" } };
const providerContext = { cwd: process.cwd() };
afterEach(() => vi.unstubAllGlobals());

describe("SerpBase search", () => {
  it("exposes credentials and options without initializing transport", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(client().getProvider("serpbase")).toMatchObject({
      capabilities: ["search"],
      configured: ["search"],
      selectedDefaults: ["search"],
      credentials: [{ name: "api", environmentVariable: "SERPBASE_API_KEY" }],
    });
    expect(client().inspectCapability("search")).toMatchObject({
      defaults: { options: { hl: "en", gl: "us", page: 1, device: "default" } },
      optionSchema: {
        additionalProperties: false,
        properties: { device: { enum: ["default", "pc", "mobile"] } },
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps the POST contract, merged options, organic links, and context", async () => {
    const fetch = mockResponse();
    vi.stubGlobal("fetch", fetch);
    const result = await client({ gl: "de", hl: "de", device: "pc" }).search({
      queries: [context.query],
      maxResults: 3,
      options: { hl: "en", page: 2 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.serpbase.dev/google/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "X-API-Key": "test-key",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      q: context.query,
      hl: "en",
      gl: "de",
      page: 2,
      device: "pc",
    });
    expect(result.status).toBe("ok");
    expect(result.results[0]).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            title: organic.title,
            url: organic.link,
            snippet: "AbortSignal documentation",
            metadata: {
              rank: 1,
              position: 1,
              sitelinks: organic.sitelinks,
              searchContext: context,
            },
          },
        ],
      },
    });
  });

  it("sends the documented defaults", async () => {
    const fetch = mockResponse();
    vi.stubGlobal("fetch", fetch);
    await client().search({ queries: ["example"] });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      q: "example",
      hl: "en",
      gl: "us",
      page: 1,
      device: "default",
    });
  });

  it.each([1, 3, 50])(
    "limits one page locally to %i results without reordering or pagination",
    async (maxResults) => {
      const entries = [3, 1, 2].map((rank) => ({
        ...organic,
        rank,
        title: `Result ${rank}`,
      }));
      const fetch = mockResponse({ ...payload, organic: entries });
      vi.stubGlobal("fetch", fetch);
      const result = await adapter.search(
        { ...request, maxResults },
        config,
        providerContext,
      );
      expect(result.results.map((entry) => entry.metadata?.rank)).toEqual(
        [3, 1, 2].slice(0, maxResults),
      );
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ q: "example" });
    },
  );

  it("handles absent results, aliases, missing snippets, and malformed rows", async () => {
    const fetch = mockResponse({
      ...payload,
      organic: [
        null,
        42,
        [],
        {},
        { title: "No link" },
        { url: "https://example.com", link: "", snippet: 42 },
        { ...organic, snippet: "x".repeat(1000) },
      ],
    });
    vi.stubGlobal("fetch", fetch);
    const result = await adapter.search(request, config, providerContext);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      title: "https://example.com",
      url: "https://example.com",
      snippet: "",
    });
    expect(result.results[1].snippet).toHaveLength(300);
    for (const body of [{ status: 0 }, { status: 0, organic: [] }]) {
      vi.stubGlobal("fetch", mockResponse(body));
      expect(
        (await adapter.search(request, config, providerContext)).results,
      ).toEqual([]);
    }
  });

  it("supports a custom origin and propagates cancellation", async () => {
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
      request,
      { ...config, baseUrl: "https://proxy.example.com///" },
      { ...providerContext, signal: controller.signal },
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://proxy.example.com/google/search",
    );
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([400, 401, 402, 429, 500, 502, 503, 504])(
    "classifies and redacts HTTP %i failures",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        mockResponse({ error: "request failed for test-key" }, status),
      );
      const result = await client().search({ queries: ["example"] });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: {
          code: "PROVIDER_FAILURE",
          retryable: status === 429 || status >= 500,
        },
      });
      expect(JSON.stringify(result)).not.toContain("test-key");
      expect(JSON.stringify(result)).toContain(`HTTP ${status}`);
    },
  );

  it.each([1000, 1001, 1004, 1020, 1029, 1500, 1502, 1503, 1504])(
    "handles business status %i even with HTTP 200",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        mockResponse({ status, error: "request failed for test-key" }),
      );
      const result = await client().search({ queries: ["example"] });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: {
          code: "PROVIDER_FAILURE",
          retryable: [1029, 1500, 1502, 1503, 1504].includes(status),
        },
      });
      expect(JSON.stringify(result)).not.toContain("test-key");
      expect(JSON.stringify(result)).toContain(`status ${status}`);
    },
  );

  it("retries transient business errors through the shared runtime, but not insufficient credits", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 1029, error: "rate limited" }),
      )
      .mockResolvedValueOnce(Response.json(payload));
    vi.stubGlobal("fetch", fetch);
    expect((await client({}, 1).search({ queries: ["example"] })).status).toBe(
      "ok",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const denied = mockResponse(
      { status: 1020, error: "insufficient credits" },
      503,
    );
    vi.stubGlobal("fetch", denied);
    expect((await client({}, 1).search({ queries: ["example"] })).status).toBe(
      "partial",
    );
    expect(denied).toHaveBeenCalledOnce();
  });

  it.each([null, [], {}, { status: "0" }, { status: 0, organic: {} }])(
    "rejects malformed success envelopes: %j",
    async (body) => {
      vi.stubGlobal("fetch", mockResponse(body));
      await expect(
        adapter.search(request, config, providerContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_FAILURE",
        options: { retryable: false },
      });
    },
  );

  it.each([200, 401, 503])(
    "handles non-JSON HTTP %i responses",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("upstream unavailable", { status })),
      );
      await expect(
        adapter.search(request, config, providerContext),
      ).rejects.toMatchObject({
        code: "PROVIDER_FAILURE",
        options: { retryable: status === 503 },
      });
    },
  );

  it("rejects missing credentials and unsupported capabilities without requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      createWebfox({ config: {}, env: {} }).search({
        provider: "serpbase",
        queries: ["example"],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    await expect(adapter.search(request, {}, providerContext)).rejects.toThrow(
      "missing an API key",
    );
    await expect(
      client().answer({ provider: "serpbase", queries: ["example"] }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { device: "desktop" },
    { device: "" },
    { page: 0 },
    { page: 1.5 },
    { page: "2" },
    { hl: "" },
    { gl: 123 },
    { num: 10 },
    { q: "override" },
    { mode: "unsupported" },
    { mode: "images", device: "pc" },
    { mode: "news", lat: 0, lng: 0 },
    { mode: "videos", zoom: 14 },
    { mode: "maps", device: "mobile" },
    { mode: "maps", lat: 91 },
    { mode: "maps", lng: -181 },
    { mode: "maps", zoom: 22 },
    { mode: "maps", zoom: 1.5 },
    { mode: "maps-detail", page: 1 },
    { mode: "maps-detail", lat: 0, lng: 0 },
  ])("rejects invalid options before requests: %j", async (options) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      validateOptions(serpbaseProvider, "search", options),
    ).toThrow();
    const configured = {
      providers: { serpbase: { options: { search: options } } },
    };
    expect(() => validateConfiguredOptions(configured)).toThrow();
    expect(Check(configurationSchema, configured)).toBe(false);
    await expect(
      client().search({ queries: ["example"], options }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { adapter } from "../src/providers/sofya/adapter.js";

const searchPayload = {
  query: "node abort",
  answer: "Use AbortController.",
  results: [
    {
      title: "Node.js",
      url: "https://nodejs.org/api/globals.html",
      content: "AbortSignal docs",
      description: null,
      fetched: false,
      published_date: "2026-01-15",
      sublinks: [],
      table: {},
    },
    {
      title: "Fallback",
      url: "https://example.org/",
      content: "x".repeat(900),
      description: "Example snippet",
      fetched: true,
    },
    { title: "No URL", content: "dropped" },
  ],
  credits_used: 1,
  credits_remaining: 99,
};
const config = { credentials: { api: "test-key" } };
const providerContext = { cwd: process.cwd() };
afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: (body: Record<string, unknown>) => Response) {
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: string, init: { body: string }) =>
      response(JSON.parse(init.body)),
    );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Sofya", () => {
  it("searches with a bearer key and maps snippets and metadata", async () => {
    const fetch = stubFetch(() => Response.json(searchPayload));

    const response = await adapter.search(
      {
        capability: "search",
        query: "node abort",
        maxResults: 40,
        options: { search_depth: "basic", freshness: "week" },
      },
      { ...config, baseUrl: "https://proxy.example/sofya/" },
      providerContext,
    );

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://proxy.example/sofya/v1/search");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      query: "node abort",
      max_results: 20,
      search_depth: "basic",
      freshness: "week",
    });
    expect(response.results.map((r) => [r.url, r.snippet])).toEqual([
      ["https://nodejs.org/api/globals.html", "AbortSignal docs"],
      ["https://example.org/", "Example snippet"],
    ]);
    expect(response.results[0].metadata).toEqual({
      published_date: "2026-01-15",
    });
    expect(response.results[1].metadata).toEqual({ content: "x".repeat(900) });
  });

  it("fetches each URL and keeps failures with their input", async () => {
    const fetch = stubFetch(({ urls }) => {
      const [url] = urls as string[];
      return Response.json({
        results: [
          url.includes("bad")
            ? { url, success: false, error: "HTTP 404" }
            : {
                url: `${url}/final`,
                title: "Page",
                content: "# Page",
                published_time: null,
                success: true,
                error: null,
                low_content: false,
              },
        ],
      });
    });

    const response = await adapter.contents(
      {
        capability: "contents",
        urls: ["https://example.org", "https://bad.example"],
      },
      config,
      providerContext,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("https://sofya.co/v1/fetch");
    expect(response.answers[0]).toMatchObject({
      inputIndex: 0,
      url: "https://example.org/final",
      content: "# Page",
      metadata: { title: "Page", low_content: false },
    });
    expect(response.answers[1]).toMatchObject({
      inputIndex: 1,
      error: { message: "HTTP 404" },
    });
  });

  it("answers through search with include_answer and lists sources", async () => {
    const fetch = stubFetch(() => Response.json(searchPayload));

    const output = await adapter.answer(
      { capability: "answer", query: "node abort", options: { topic: "news" } },
      config,
      providerContext,
    );

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      query: "node abort",
      include_answer: true,
      topic: "news",
    });
    expect(output.text).toBe(
      [
        "Use AbortController.",
        "",
        "Sources:",
        "1. Node.js",
        "   https://nodejs.org/api/globals.html",
        "2. Fallback",
        "   https://example.org/",
      ].join("\n"),
    );
    expect(output.itemCount).toBe(2);
  });

  it("returns the research report with its sources", async () => {
    const fetch = stubFetch(() =>
      Response.json({
        query: "wasm",
        report: "WebAssembly runs outside browsers [1].",
        sources: [{ title: "WASI", url: "https://wasi.dev/", fetched: true }],
        sub_queries: ["wasi", "wasm runtimes"],
      }),
    );

    const output = await adapter.research(
      { capability: "research", input: "wasm", options: { max_sources: 5 } },
      config,
      providerContext,
    );

    expect(fetch.mock.calls[0][0]).toBe("https://sofya.co/v1/research");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      query: "wasm",
      max_sources: 5,
    });
    expect(output.text).toContain("WebAssembly runs outside browsers [1].");
    expect(output.text).toContain("1. WASI\n   https://wasi.dev/");
    expect(output.metadata).toEqual({ sub_queries: ["wasi", "wasm runtimes"] });
  });

  it("reports HTTP and shape failures", async () => {
    const request = {
      capability: "search",
      query: "node abort",
      maxResults: 5,
    } as const;
    stubFetch(() =>
      Response.json({ detail: "Invalid API key" }, { status: 401 }),
    );
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/HTTP 401\): Invalid API key/);
    stubFetch(() =>
      Response.json({ detail: [{ msg: "bad freshness" }] }, { status: 422 }),
    );
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/HTTP 422\): .*bad freshness/);
    stubFetch(() => Response.json({ nope: 1 }));
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/invalid search response/);
  });

  it("is registered and keyed by SOFYA_API_KEY", () => {
    const webfox = createWebfox({
      config: {},
      env: { SOFYA_API_KEY: "test-key" },
    });
    expect(webfox.getProvider("sofya")).toMatchObject({ id: "sofya" });
  });
});

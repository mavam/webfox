import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { adapter } from "../src/providers/keenable/adapter.js";

const payload = {
  query: "node abort",
  mode: "pro",
  results: [
    {
      title: "Node.js",
      url: "https://nodejs.org/api/globals.html",
      description: "",
      snippet: "AbortSignal docs",
      published_at: "2026-01-15T10:30:00Z",
    },
    {
      title: "Fallback",
      url: "https://example.org/",
      snippet: "x".repeat(900),
    },
    { title: "No URL", snippet: "dropped" },
  ],
};
const request = {
  capability: "search",
  query: "node abort",
  maxResults: 5,
} as const;
const config = { credentials: { api: "test-key" } };
const providerContext = { cwd: process.cwd() };
afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: () => Response) {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Keenable search", () => {
  it("posts the query with X-API-Key and maps snippets and metadata", async () => {
    const fetch = stubFetch(() => Response.json(payload));

    const response = await adapter.search(request, config, providerContext);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.keenable.ai/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      query: "node abort",
      max_results: 5,
    });
    expect(response.provider).toBe("keenable");
    expect(response.results.map((r) => [r.url, r.snippet])).toEqual([
      ["https://nodejs.org/api/globals.html", "AbortSignal docs"],
      ["https://example.org/", `${"x".repeat(299)}…`],
    ]);
    expect(response.results[0].metadata).toEqual({
      published_at: "2026-01-15T10:30:00Z",
    });
  });

  it("caps max_results at 50 and forwards native options", async () => {
    const fetch = stubFetch(() => Response.json(payload));

    await adapter.search(
      {
        ...request,
        maxResults: 80,
        options: {
          mode: "realtime",
          site: "nodejs.org",
          published_after: "7d",
        },
      },
      { ...config, baseUrl: "https://proxy.example/keenable/" },
      providerContext,
    );

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://proxy.example/keenable/v1/search");
    expect(JSON.parse(init.body)).toEqual({
      query: "node abort",
      max_results: 50,
      mode: "realtime",
      site: "nodejs.org",
      published_after: "7d",
    });
  });

  it("reports HTTP and shape failures", async () => {
    stubFetch(() =>
      Response.json(
        { detail: "must be an integer between 1 and 50" },
        { status: 400 },
      ),
    );
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/HTTP 400\): must be an integer between 1 and 50/);
    stubFetch(() => Response.json({}, { status: 401 }));
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/HTTP 401/);
    stubFetch(() => Response.json({ nope: 1 }));
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/invalid search response/);
  });

  it("is registered and keyed by KEENABLE_API_KEY", () => {
    const webfox = createWebfox({
      config: {},
      env: { KEENABLE_API_KEY: "test-key" },
    });
    expect(webfox.getProvider("keenable")).toMatchObject({ id: "keenable" });
  });
});

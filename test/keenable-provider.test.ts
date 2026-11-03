import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { adapter } from "../src/providers/keenable/adapter.js";

const payload = {
  results: [
    {
      title: "Node.js",
      url: "https://nodejs.org/api/globals.html",
      description: "AbortSignal docs",
      snippet: "long excerpt",
      score: 0.9,
    },
    {
      title: "Fallback",
      url: "https://example.org/",
      snippet: "x".repeat(900),
    },
    { title: "No URL", description: "dropped" },
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

describe("Keenable search", () => {
  it("posts the query with X-API-Key and maps description, then snippet", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetch);

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
    expect(response.results[0].metadata).toEqual({ score: 0.9 });
  });

  it("reports HTTP and shape failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () => Response.json({}, { status: 401 })),
    );
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/HTTP 401/);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json({ nope: 1 })),
    );
    await expect(
      adapter.search(request, config, providerContext),
    ).rejects.toThrow(/invalid search response/);
  });

  it("is registered, keyed by KEENABLE_API_KEY, and not a default", () => {
    const webfox = createWebfox({
      config: {},
      env: { KEENABLE_API_KEY: "test-key" },
    });
    expect(webfox.getProvider("keenable")).toMatchObject({ id: "keenable" });
  });
});

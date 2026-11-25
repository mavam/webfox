import { afterEach, describe, expect, it, vi } from "vitest";
import { tavilyProvider } from "../src/providers/tavily/definition.js";
import { providerHarness } from "./provider-harness.js";
import { stubFetch } from "./fetch-stub.js";

afterEach(() => {
  delete process.env.TAVILY_API_KEY;
  vi.unstubAllGlobals();
});

describe("providerHarness(tavilyProvider)", () => {
  it("merges search options, overrides maxResults, forwards AbortSignal, and preserves metadata", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        query: "tavily sdk",
        response_time: 1.09,
        request_id: "request-123",
        usage: { credits: 1 },
        images: [],
        results: [
          {
            title: "Tavily Docs",
            url: "https://docs.tavily.com",
            content: "A".repeat(400),
            raw_content: "Raw Tavily Docs",
            score: 0.92,
            published_date: "2026-03-01",
            favicon: "https://docs.tavily.com/favicon.ico",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await providerHarness(tavilyProvider).search(
      "tavily sdk",
      5,
      { credentials: { api: "test-key" }, baseUrl: "https://api.tavily.test" },
      { cwd: process.cwd(), signal: controller.signal },
      {
        topic: "news",
        country: "US",
        maxResults: 50,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.test/search");
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "tavily sdk",
      topic: "news",
      country: "US",
      max_results: 5,
    });
    expect(response.results).toEqual([
      {
        title: "Tavily Docs",
        url: "https://docs.tavily.com",
        snippet: `${"A".repeat(299)}…`,
        score: 0.92,
        metadata: {
          publishedDate: "2026-03-01",
          favicon: "https://docs.tavily.com/favicon.ico",
          rawContent: "Raw Tavily Docs",
          requestId: "request-123",
          usage: { credits: 1 },
          responseTime: 1.09,
        },
      },
    ]);
  });

  it("extracts page contents with metadata and surfaces failed extractions", async () => {
    const calls = stubFetch(({ body }) => {
      const [url] = body.urls as string[];
      if (url === "https://example.com/b") {
        return {
          results: [
            {
              url: "https://example.com/b",
              title: "Page B",
              raw_content: "Body B",
              images: ["https://example.com/image.png"],
              favicon: "https://example.com/favicon.ico",
            },
          ],
          failed_results: [],
          response_time: 2.5,
          request_id: "extract-123",
        };
      }
      return {
        results: [],
        failed_results: [{ url: "https://example.com/a", error: "blocked" }],
        response_time: 1.2,
        request_id: "extract-124",
      };
    });

    const page = await providerHarness(tavilyProvider).contents(
      "https://example.com/b",
      { credentials: { api: "literal-key" } },
      { cwd: process.cwd() },
      {
        format: "markdown",
        includeImages: true,
      },
    );

    expect(calls[0]).toMatchObject({
      url: "https://api.tavily.com/extract",
      headers: expect.objectContaining({
        authorization: "Bearer literal-key",
      }),
      body: {
        urls: ["https://example.com/b"],
        format: "markdown",
        include_images: true,
      },
    });
    expect(page).toEqual({
      url: "https://example.com/b",
      content: "Body B",
      metadata: {
        title: "Page B",
        images: ["https://example.com/image.png"],
        favicon: "https://example.com/favicon.ico",
        requestId: "extract-123",
        responseTime: 2.5,
      },
    });

    await expect(
      providerHarness(tavilyProvider).contents(
        "https://example.com/a",
        { credentials: { api: "literal-key" } },
        { cwd: process.cwd() },
        {
          format: "markdown",
          includeImages: true,
        },
      ),
    ).rejects.toThrow("blocked");
  });
});

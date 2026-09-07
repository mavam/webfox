import { afterEach, describe, expect, it, vi } from "vitest";
import { youcomProvider } from "../src/providers/youcom/definition.js";
import { providerHarness } from "./provider-harness.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.YDC_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("providerHarness(youcomProvider)", () => {
  it("maps web and news results and forwards search controls", async () => {
    process.env.YDC_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: {
            web: [
              {
                url: "https://example.com/web",
                title: "Web Result",
                description: "Web description",
                snippets: ["Web snippet", "Second snippet"],
                favicon_url: "https://example.com/favicon.ico",
              },
            ],
            news: [
              {
                url: "https://example.com/news",
                title: "News Result",
                description: "News description",
                page_age: "2026-09-07T16:00:00",
                thumbnail_url: "https://example.com/news.png",
              },
            ],
          },
          metadata: {
            query: "example query",
            search_uuid: "uuid-123",
            latency: 0.23,
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(youcomProvider).search(
      "example query",
      7,
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      {
        freshness: "week",
        country: "US",
        language: "en",
        safesearch: "strict",
        knowledge: true,
        offset: 2,
        include_domains: ["example.com"],
        extraction: {
          extraction_mode: "highlights",
          crawl_timeout: 15,
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith("https://ydc-index.io/v1/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": "test-key",
      },
      body: JSON.stringify({
        query: "example query",
        count: 7,
        freshness: "week",
        country: "US",
        language: "en",
        safesearch: "strict",
        knowledge: true,
        offset: 2,
        include_domains: ["example.com"],
        extraction: {
          extraction_mode: "highlights",
          crawl_timeout: 15,
        },
      }),
      signal: undefined,
    });
    expect(response).toEqual({
      provider: "youcom",
      results: [
        {
          title: "Web Result",
          url: "https://example.com/web",
          snippet: "Web snippet Second snippet",
          metadata: {
            section: "web",
            searchMetadata: {
              query: "example query",
              search_uuid: "uuid-123",
              latency: 0.23,
            },
            url: "https://example.com/web",
            title: "Web Result",
            description: "Web description",
            snippets: ["Web snippet", "Second snippet"],
            favicon_url: "https://example.com/favicon.ico",
          },
        },
        {
          title: "News Result",
          url: "https://example.com/news",
          snippet: "News description",
          metadata: {
            section: "news",
            searchMetadata: {
              query: "example query",
              search_uuid: "uuid-123",
              latency: 0.23,
            },
            url: "https://example.com/news",
            title: "News Result",
            description: "News description",
            page_age: "2026-09-07T16:00:00",
            thumbnail_url: "https://example.com/news.png",
          },
        },
      ],
    });
  });

  it("rejects conflicting domain filters before making a request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      providerHarness(youcomProvider).search(
        "example query",
        5,
        { credentials: { api: "test-key" } },
        { cwd: process.cwd() },
        {
          include_domains: ["example.com"],
          exclude_domains: ["news.example.com"],
        },
      ),
    ).rejects.toThrow(
      "You.com search options include_domains and exclude_domains cannot be used together.",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

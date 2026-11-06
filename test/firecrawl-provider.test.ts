import { afterEach, describe, expect, it, vi } from "vitest";

import { firecrawlProvider } from "../src/providers/firecrawl/definition.js";
import { providerHarness } from "./provider-harness.js";
import { jsonResponse, stubFetch } from "./fetch-stub.js";

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
  vi.unstubAllGlobals();
});

describe("providerHarness(firecrawlProvider)", () => {
  it("searches with a custom base URL without an API key", async () => {
    const calls = stubFetch(() => ({ success: true, data: { web: [] } }));

    const response = await providerHarness(firecrawlProvider).search(
      "firecrawl sdk",
      4,
      {
        baseUrl: "http://localhost:3002",
      },
      { cwd: process.cwd() },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:3002/v2/search");
    expect(calls[0]?.headers).not.toHaveProperty("authorization");
    expect(calls[0]?.body).toEqual({ query: "firecrawl sdk", limit: 4 });
    expect(response.results).toEqual([]);
  });

  it("merges search options and maps results", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";

    const calls = stubFetch(() => ({
      success: true,
      data: {
        web: [
          {
            title: "Firecrawl Docs",
            url: "https://docs.firecrawl.dev",
            description: "Official documentation",
            category: "research",
          },
          {
            markdown: "# Deep scrape\n\n" + "A".repeat(400),
            metadata: {
              title: "Scraped result",
              sourceURL: "https://example.com/scraped",
              description: "Structured scrape",
            },
          },
        ],
        news: [
          {
            title: "Firecrawl launches feature",
            url: "https://news.example.com/firecrawl",
            snippet: "Launch coverage",
            date: "2026-04-01",
          },
        ],
        images: [
          {
            title: "Firecrawl logo",
            imageUrl: "https://example.com/logo.png",
            position: 1,
          },
        ],
      },
    }));

    const response = await providerHarness(firecrawlProvider).search(
      "firecrawl sdk",
      4,
      {
        credentials: { api: "test-key" },
        baseUrl: "https://api.firecrawl.test",
      },
      { cwd: process.cwd() },
      {
        ...{
          sources: ["web", "news"],
          timeout: 15,
        },
        ...{
          location: "us",
          limit: 99,
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.firecrawl.test/v2/search",
      method: "POST",
      headers: { authorization: "Bearer test-key" },
    });
    expect(calls[0]?.body).toEqual({
      query: "firecrawl sdk",
      sources: ["web", "news"],
      timeout: 15,
      location: "us",
      limit: 4,
    });
    expect(response.results).toHaveLength(4);
    expect(response.results[0]).toEqual({
      title: "Firecrawl Docs",
      url: "https://docs.firecrawl.dev",
      snippet: "Official documentation",
      metadata: {
        source: "web",
        category: "research",
      },
    });
    expect(response.results[1]).toMatchObject({
      title: "Scraped result",
      url: "https://example.com/scraped",
      metadata: {
        source: "web",
        title: "Scraped result",
        sourceURL: "https://example.com/scraped",
        description: "Structured scrape",
      },
    });
    expect(response.results[1]?.snippet).toMatch(/^# Deep scrape A+/);
    expect(response.results[1]?.snippet.endsWith("…")).toBe(true);
    expect(response.results[2]).toEqual({
      title: "Firecrawl launches feature",
      url: "https://news.example.com/firecrawl",
      snippet: "Launch coverage",
      metadata: {
        source: "news",
        date: "2026-04-01",
      },
    });
    expect(response.results[3]).toEqual({
      title: "Firecrawl logo",
      url: "https://example.com/logo.png",
      snippet: "",
      metadata: {
        source: "images",
        imageUrl: "https://example.com/logo.png",
        position: 1,
      },
    });
  });

  it("preserves URL order for contents, merges scrape options, and surfaces per-URL failures", async () => {
    const calls = stubFetch(({ body: { url } }) => {
      if (url === "https://example.com/a") {
        return {
          success: true,
          data: {
            markdown: "# Page A\n\nBody A",
            metadata: {
              title: "Page A",
              sourceURL: "https://example.com/a?ref=firecrawl",
            },
            links: ["https://example.com/a/child"],
          },
        };
      }
      if (url === "https://example.com/b") {
        return jsonResponse(
          { success: false, error: "blocked by robots" },
          403,
        );
      }
      return {
        success: true,
        data: {
          json: {
            title: "Page C",
            items: [1, 2, 3],
          },
          metadata: {
            title: "Page C",
          },
        },
      };
    });

    const response = await providerHarness(firecrawlProvider).contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      { credentials: { api: "literal-key" } },
      { cwd: process.cwd() },
      {
        ...{
          formats: ["markdown"],
          waitFor: 500,
        },
        ...{
          formats: ["html"],
          mobile: true,
        },
      },
    );

    expect(
      calls.map(({ url, headers }) => [url, headers.authorization]),
    ).toEqual(
      Array(3).fill([
        "https://api.firecrawl.dev/v2/scrape",
        "Bearer literal-key",
      ]),
    );
    expect(calls.map(({ body }) => body)).toEqual(
      ["a", "b", "c"].map((page) => ({
        url: `https://example.com/${page}`,
        formats: ["html"],
        onlyMainContent: true,
        waitFor: 500,
        mobile: true,
      })),
    );
    expect(response.answers).toMatchObject([
      {
        inputIndex: 0,
        url: "https://example.com/a",
        content: "# Page A\n\nBody A",
        metadata: {
          title: "Page A",
          sourceURL: "https://example.com/a?ref=firecrawl",
        },
      },
      {
        inputIndex: 1,
        url: "https://example.com/b",
        error: { code: "PROVIDER_FAILURE", message: "blocked by robots" },
      },
      {
        inputIndex: 2,
        url: "https://example.com/c",
        content: JSON.stringify(
          {
            title: "Page C",
            items: [1, 2, 3],
          },
          null,
          2,
        ),
        metadata: {
          title: "Page C",
        },
      },
    ]);
  });

  it("answers a question about one URL using Firecrawl's question scrape format", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const calls = stubFetch(() => ({
      success: true,
      data: {
        answer: "The page says Firecrawl supports question scraping.",
        metadata: {
          title: "Firecrawl Docs",
        },
      },
    }));

    const response = await providerHarness(firecrawlProvider).answer(
      "What does the page say about question scraping?",
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      {
        ...{
          formats: ["markdown"],
          onlyMainContent: false,
          waitFor: 100,
        },
        ...{
          url: "https://docs.firecrawl.dev/features/scrape",
          mobile: true,
        },
        ...{
          url: "https://docs.firecrawl.dev/features/scrape#question-format",
          waitFor: 250,
        },
      },
    );

    expect(calls).toEqual([
      {
        url: "https://api.firecrawl.dev/v2/scrape",
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer test-key",
        },
        body: {
          onlyMainContent: false,
          waitFor: 250,
          mobile: true,
          url: "https://docs.firecrawl.dev/features/scrape#question-format",
          formats: [
            {
              type: "question",
              question: "What does the page say about question scraping?",
            },
          ],
        },
      },
    ]);
    expect(response).toEqual({
      provider: "firecrawl",
      text: "The page says Firecrawl supports question scraping.",
      sources: [
        { url: "https://docs.firecrawl.dev/features/scrape#question-format" },
      ],
      metadata: {
        url: "https://docs.firecrawl.dev/features/scrape#question-format",
        metadata: {
          title: "Firecrawl Docs",
        },
      },
    });
  });

  it("requires a URL for Firecrawl answers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "What does this page say?",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow("Firecrawl answer requires options.url.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty Firecrawl answer question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "   ",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("question must be a non-empty string.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Firecrawl answer questions over 10000 characters", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "A".repeat(10_001),
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("Firecrawl question must be at most 10000 characters.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates Firecrawl answer API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: "question format is unavailable",
          }),
          { status: 400, statusText: "Bad Request" },
        ),
      ),
    );

    await expect(
      providerHarness(firecrawlProvider).answer(
        "What changed?",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("question format is unavailable");
  });
});

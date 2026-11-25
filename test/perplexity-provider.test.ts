import { afterEach, describe, expect, it, vi } from "vitest";
import { perplexityProvider } from "../src/providers/perplexity/definition.js";
import { providerHarness } from "./provider-harness.js";
import { stubFetch } from "./fetch-stub.js";

afterEach(() => {
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_CUSTOM_HEADERS;
  vi.unstubAllGlobals();
});

describe("Perplexity provider", () => {
  it("forwards merged search options and preserves date metadata", async () => {
    const calls = stubFetch(() => ({
      results: [
        {
          title: "Energy policy",
          url: "https://example.com/policy",
          snippet: "Recent policy changes",
          date: "2026-03-01",
          last_updated: "2026-03-05",
        },
      ],
    }));

    const provider = providerHarness(perplexityProvider);
    const response = await provider.search(
      "government policies on renewable energy",
      5,
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      {
        search_mode: "academic",
        country: "US",
        max_results: 99,
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.perplexity.ai/search",
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "x-pplx-integration": "webfox",
        }),
        body: {
          search_mode: "academic",
          country: "US",
          query: "government policies on renewable energy",
          max_results: 5,
        },
      }),
    ]);
    expect(response.results).toEqual([
      {
        title: "Energy policy",
        url: "https://example.com/policy",
        snippet: "Recent policy changes",
        metadata: {
          date: "2026-03-01",
          last_updated: "2026-03-05",
        },
      },
    ]);
  });

  it("defaults answer calls to sonar and dedupes repeated sources", async () => {
    const calls = stubFetch(() => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Perplexity answer",
          },
        },
      ],
      search_results: [
        {
          title: "Source A",
          url: "https://example.com/a",
        },
        {
          title: "Source A",
          url: "https://example.com/a",
        },
      ],
    }));

    const provider = providerHarness(perplexityProvider);
    const response = await provider.answer(
      "What changed?",
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      { country: "US" },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.perplexity.ai/chat/completions",
        method: "POST",
        body: {
          country: "US",
          messages: [{ role: "user", content: "What changed?" }],
          model: "sonar",
          stream: false,
        },
      }),
    ]);
    expect(response.text).toBe("Perplexity answer");
    expect(response.sources).toEqual([
      { url: "https://example.com/a", title: "Source A" },
    ]);
  });

  it("streams research calls with sonar-deep-research", async () => {
    const sse = [
      `data: ${JSON.stringify({
        choices: [
          {
            delta: { role: "assistant", content: "Research " },
            message: { role: "assistant", content: null },
          },
        ],
      })}`,
      "",
      `data: ${JSON.stringify({
        choices: [
          {
            delta: { role: "assistant", content: "result" },
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Research result" }],
            },
          },
        ],
        citations: ["https://example.com/research"],
      })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const calls = stubFetch(
      () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const provider = providerHarness(perplexityProvider);
    const response = await provider.research(
      "Investigate the topic",
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      undefined,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.perplexity.ai/chat/completions",
        method: "POST",
        body: {
          messages: [{ role: "user", content: "Investigate the topic" }],
          model: "sonar-deep-research",
          stream: true,
        },
      }),
    ]);
    expect(response.text).toBe("Research result");
    expect(response.sources).toEqual([{ url: "https://example.com/research" }]);
  });

  it("falls back to citations when search_results is empty", async () => {
    stubFetch(() => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Answer with citations fallback",
          },
        },
      ],
      search_results: [],
      citations: ["https://example.com/fallback"],
    }));

    const provider = providerHarness(perplexityProvider);
    const response = await provider.answer(
      "What changed?",
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      undefined,
    );

    expect(response.text).toBe("Answer with citations fallback");
    expect(response.sources).toEqual([{ url: "https://example.com/fallback" }]);
  });

  it.each([
    ["https://api.perplexity.ai", true],
    ["https://api.perplexity.ai/", true],
    ["http://127.0.0.1:8080", false],
    ["https://api.perplexity.ai.example.com", false],
    ["https://proxy.example.com/api.perplexity.ai", false],
  ])(
    "sets the integration header only for the Perplexity API host (%s)",
    async (baseUrl, expected) => {
      const calls = stubFetch(() => ({ results: [] }));

      const provider = providerHarness(perplexityProvider);
      await provider.search(
        "q",
        1,
        { baseUrl, credentials: { api: "test-key" } },
        { cwd: process.cwd() },
        {},
      );

      expect(calls[0]?.headers["x-pplx-integration"]).toBe(
        expected ? "webfox" : undefined,
      );
    },
  );

  it("keeps a caller-supplied integration header from PERPLEXITY_CUSTOM_HEADERS", async () => {
    process.env.PERPLEXITY_CUSTOM_HEADERS = "x-pplx-integration: my-app";
    const calls = stubFetch(() => ({ results: [] }));

    const provider = providerHarness(perplexityProvider);
    await provider.search(
      "q",
      1,
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      {},
    );

    expect(calls[0]?.headers["x-pplx-integration"]).toBe("my-app");
  });
});

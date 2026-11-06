import { afterEach, describe, expect, it, vi } from "vitest";

import { linkupProvider } from "../src/providers/linkup/definition.js";
import { providerHarness } from "./provider-harness.js";
import { jsonResponse, stubFetch } from "./fetch-stub.js";

afterEach(() => {
  delete process.env.LINKUP_API_KEY;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("providerHarness(linkupProvider)", () => {
  it("forwards supported Linkup search options and keeps search-results output fixed", async () => {
    process.env.LINKUP_API_KEY = "test-key";

    const calls = stubFetch(() => ({
      results: [
        {
          type: "text",
          name: "Linkup Docs",
          url: "https://docs.linkup.so",
          content: "Official documentation for Linkup.",
          favicon: "https://docs.linkup.so/favicon.ico",
        },
        {
          type: "image",
          name: "Linkup logo",
          url: "https://example.com/logo.png",
        },
      ],
    }));

    const response = await providerHarness(linkupProvider).search(
      "linkup sdk",
      2,
      {
        credentials: { api: "test-key" },
        baseUrl: "https://api.linkup.test/v1",
      },
      { cwd: process.cwd() },
      {
        ...{
          includeImages: true,
          excludeDomains: ["example.com"],
        },
        ...{
          depth: "deep",
          includeDomains: ["docs.linkup.so"],
          fromDate: "2026-01-02T03:04:05.000Z",
          requestTimeoutMs: 5000,
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.linkup.test/v1/search",
      method: "POST",
      headers: { authorization: "Bearer test-key" },
    });
    expect(calls[0]?.body).toEqual({
      q: "linkup sdk",
      depth: "deep",
      outputType: "searchResults",
      maxResults: 2,
      includeImages: true,
      includeDomains: ["docs.linkup.so"],
      excludeDomains: ["example.com"],
      fromDate: "2026-01-02",
    });
    expect(response).toEqual({
      provider: "linkup",
      results: [
        {
          title: "Linkup Docs",
          url: "https://docs.linkup.so",
          snippet: "Official documentation for Linkup.",
          metadata: {
            type: "text",
            favicon: "https://docs.linkup.so/favicon.ico",
          },
        },
        {
          title: "Linkup logo",
          url: "https://example.com/logo.png",
          snippet: "",
          metadata: {
            type: "image",
          },
        },
      ],
    });
  });

  it("rejects incompatible Linkup search option overrides", async () => {
    await expect(
      providerHarness(linkupProvider).search(
        "linkup sdk",
        2,
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        {
          outputType: "structured",
        },
      ),
    ).rejects.toThrow(/only supports outputType 'searchResults'/);
  });

  it("forwards Linkup fetch options per URL and preserves URL order", async () => {
    const calls = stubFetch(({ body }) => {
      if (body.url === "https://example.com/a") {
        return {
          markdown: "# Page A\n\nBody A",
        };
      }
      if (body.url === "https://example.com/b") {
        return jsonResponse(
          {
            statusCode: 400,
            error: { code: "FETCH_ERROR", message: "blocked by robots" },
          },
          400,
        );
      }
      return {
        markdown: "",
      };
    });

    const response = await providerHarness(linkupProvider).contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      { credentials: { api: "literal-key" } },
      { cwd: process.cwd() },
      {
        ...{
          includeRawHtml: true,
        },
        ...{
          renderJs: true,
          extractImages: true,
          retryCount: 2,
        },
      },
    );

    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.linkup.so/v1/fetch",
      "https://api.linkup.so/v1/fetch",
      "https://api.linkup.so/v1/fetch",
    ]);
    expect(calls.map(({ body }) => body)).toEqual(
      ["a", "b", "c"].map((page) => ({
        url: `https://example.com/${page}`,
        renderJs: true,
        includeRawHtml: true,
        extractImages: true,
      })),
    );
    expect(response.answers).toMatchObject([
      {
        inputIndex: 0,
        url: "https://example.com/a",
        content: "# Page A\n\nBody A",
      },
      {
        inputIndex: 1,
        url: "https://example.com/b",
        error: { code: "PROVIDER_FAILURE", message: "blocked by robots" },
      },
      {
        inputIndex: 2,
        url: "https://example.com/c",
      },
    ]);
  });

  it("starts Linkup research, polls by id, and formats sourced answers", async () => {
    vi.useFakeTimers();

    process.env.LINKUP_API_KEY = "test-key";
    const polls = [
      {
        id: "linkup-research-1",
        status: "processing",
        output: null,
        error: null,
      },
      {
        id: "linkup-research-1",
        status: "completed",
        output: {
          answer: "Linkup research result",
          sources: [
            {
              name: "Source A",
              url: "https://example.com/a",
              snippet: "A",
              favicon: "https://example.com/favicon.ico",
            },
          ],
        },
        error: null,
      },
    ];
    const calls = stubFetch(({ method }) =>
      method === "POST"
        ? { id: "linkup-research-1", status: "pending" }
        : polls.shift(),
    );

    const promise = providerHarness(linkupProvider).research(
      "Investigate Linkup research",
      {
        credentials: { api: "test-key" },
        baseUrl: "https://api.linkup.test/v1",
      },
      { cwd: process.cwd() },
      {
        ...{
          includeDomains: ["docs.linkup.so"],
          reasoningDepth: "M",
        },
        ...{
          mode: "investigate",
          reasoningDepth: "L",
          excludeDomains: ["example.net"],
          fromDate: "2026-01-02T03:04:05.000Z",
        },
      },
    );

    await vi.advanceTimersByTimeAsync(3000);
    const response = await promise;

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST https://api.linkup.test/v1/research",
      "GET https://api.linkup.test/v1/research/linkup-research-1",
      "GET https://api.linkup.test/v1/research/linkup-research-1",
    ]);
    expect(calls[0]?.body).toEqual({
      q: "Investigate Linkup research",
      outputType: "sourcedAnswer",
      includeDomains: ["docs.linkup.so"],
      excludeDomains: ["example.net"],
      fromDate: "2026-01-02",
      mode: "investigate",
      reasoningDepth: "L",
    });
    expect(response).toEqual({
      provider: "linkup",
      text: "Linkup research result",
      sources: [{ url: "https://example.com/a", title: "Source A" }],
    });
  });

  it("returns a sourced Linkup answer without text as an empty answer", async () => {
    process.env.LINKUP_API_KEY = "test-key";
    stubFetch(({ method }) =>
      method === "POST"
        ? { id: "linkup-research-empty", status: "pending" }
        : {
            id: "linkup-research-empty",
            status: "completed",
            output: {
              answer: null,
              sources: [{ name: "Source A", url: "https://example.com/a" }],
            },
            error: null,
          },
    );

    const response = await providerHarness(linkupProvider).research(
      "Investigate",
      { credentials: { api: "test-key" } },
      { cwd: process.cwd() },
    );

    expect(response).toEqual({
      provider: "linkup",
      text: "",
      sources: [{ title: "Source A", url: "https://example.com/a" }],
    });
  });

  it("infers structured Linkup research output from structuredOutputSchema", async () => {
    const calls = stubFetch(({ method }) =>
      method === "POST"
        ? { id: "linkup-research-structured", status: "pending" }
        : {
            id: "linkup-research-structured",
            status: "completed",
            output: {
              companies: [
                {
                  name: "Example Corp",
                  score: 0.9,
                },
              ],
            },
            error: null,
          },
    );

    const response = await providerHarness(linkupProvider).research(
      "Find companies",
      {
        credentials: { api: "literal-key" },
      },
      { cwd: process.cwd() },
      {
        structuredOutputSchema: {
          type: "object",
          properties: {
            companies: {
              type: "array",
            },
          },
        },
      },
    );

    expect(calls[0]?.body).toEqual({
      q: "Find companies",
      outputType: "structured",
      structuredOutputSchema: JSON.stringify({
        type: "object",
        properties: {
          companies: {
            type: "array",
          },
        },
      }),
    });
    expect(response).toEqual({
      provider: "linkup",
      text: JSON.stringify(
        {
          companies: [
            {
              name: "Example Corp",
              score: 0.9,
            },
          ],
        },
        null,
        2,
      ),
    });
  });

  it("maps failed Linkup research tasks to terminal research errors", async () => {
    stubFetch(({ method }) =>
      method === "POST"
        ? { id: "linkup-research-failed", status: "pending" }
        : {
            id: "linkup-research-failed",
            status: "failed",
            output: null,
            error: "quota exceeded",
          },
    );

    await expect(
      providerHarness(linkupProvider).research(
        "Investigate failure",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/Linkup research failed: quota exceeded/);
  });

  it("rejects incompatible Linkup research option overrides", async () => {
    await expect(
      providerHarness(linkupProvider).research(
        "Investigate Linkup",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        {
          query: "override",
        },
      ),
    ).rejects.toThrow(/cannot override the managed input/);

    await expect(
      providerHarness(linkupProvider).research(
        "Investigate Linkup",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        {
          outputType: "structured",
        },
      ),
    ).rejects.toThrow(/requires structuredOutputSchema/);
  });
});

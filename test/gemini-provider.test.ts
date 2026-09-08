import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapter,
  geminiImplementation as provider,
} from "../src/providers/gemini/adapter.js";
import { createWebfox, parseConfig } from "../src/index.js";
import { asWebfoxError } from "../src/errors.js";
import type { ProviderContext } from "../src/providers/contract.js";

const config = { credentials: { api: "literal-key" } };
const context: ProviderContext = { cwd: process.cwd() };
const base = "https://generativelanguage.googleapis.com/v1beta/";

function mockResponse(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof mockResponse>) {
  return JSON.parse(fetchMock.mock.calls[0]![1].body);
}

function answerPayload(text = "Answer") {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Gemini capability boundaries", () => {
  it("offers answers and research, not standalone search or contents", async () => {
    const client = createWebfox({
      config: {},
      env: { GOOGLE_API_KEY: "test-key" },
    });
    const info = client.getProvider("gemini")!;
    expect(info.capabilities).toEqual(["answer", "research"]);
    expect(info.configured).toEqual(["answer", "research"]);
    expect("search" in adapter).toBe(false);
    expect("contents" in provider).toBe(false);
    await expect(
      client.search({ provider: "gemini", queries: ["test"] }),
    ).rejects.toThrow("does not support search");
  });

  it("rejects obsolete Gemini search configuration", () => {
    expect(() =>
      createWebfox({
        config: { defaults: { search: { provider: "gemini" } } },
      }),
    ).toThrow();
    expect(() =>
      parseConfig("providers:\n  gemini:\n    options:\n      search: {}\n"),
    ).toThrow();
  });
});

describe("Gemini HTTP answers", () => {
  it("defaults to Gemini 3.8 Flash with Google Search grounding", async () => {
    const fetchMock = mockResponse(answerPayload());
    expect(await provider.answer("Question", config, context)).toEqual({
      provider: "gemini",
      text: "Answer",
      itemCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}models/gemini-3.8-flash:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": "literal-key",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Question" }] }],
          tools: [{ googleSearch: {} }],
        }),
        signal: undefined,
      },
    );
    expect(
      createWebfox({ config: {}, env: {} }).inspectCapability(
        "answer",
        "gemini",
      ).defaults.options?.model,
    ).toBe("gemini-3.8-flash");
  });

  it("maps supported generation options and keeps grounding enabled", async () => {
    const fetchMock = mockResponse(answerPayload());
    const generationConfig = {
      thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: true },
      temperature: 0,
      topP: 0.8,
      topK: 10,
      candidateCount: 1,
      maxOutputTokens: 512,
    };
    await provider.answer("Question", config, context, {
      model: "models/gemini-2.5-pro",
      config: { ...generationConfig, tools: [{ urlContext: {} }] },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${base}models/gemini-2.5-pro:generateContent`,
    );
    expect(requestBody(fetchMock)).toEqual({
      contents: [{ role: "user", parts: [{ text: "Question" }] }],
      tools: [{ googleSearch: {} }],
      generationConfig,
    });
  });

  it("preserves the SDK's rejection of Developer API labels", async () => {
    const fetchMock = mockResponse({});
    await expect(
      provider.answer("Question", config, context, {
        config: { labels: { route: "answer" } },
      }),
    ).rejects.toThrow("config.labels is not supported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("joins text from the first candidate and excludes thoughts and non-text parts", async () => {
    mockResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: "Private", thought: true },
              { text: "Hello " },
              { inlineData: {} },
              { text: "world" },
            ],
          },
        },
        { content: { parts: [{ text: "Alternative" }] } },
      ],
    });
    expect((await provider.answer("Question", config, context)).text).toBe(
      "Hello world",
    );
  });

  it.each([
    {},
    { candidates: [] },
    { candidates: [{ content: { parts: [{ text: " " }] } }] },
  ])("handles empty answer content", async (payload) => {
    mockResponse(payload);
    expect((await provider.answer("Question", config, context)).text).toBe(
      "No answer returned.",
    );
  });

  it("suppresses opaque grounding redirects, deduplicates sources, and caps them at five", async () => {
    mockResponse({
      candidates: [
        {
          content: { parts: [{ text: "Grounded answer" }] },
          groundingMetadata: {
            groundingChunks: [
              {
                web: {
                  title: "ACME overview",
                  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-1",
                },
              },
              { web: { title: "ACME docs", uri: "https://example.com/docs" } },
              {
                web: {
                  title: "ACME overview",
                  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-2",
                },
              },
              ...Array.from({ length: 6 }, (_, i) => ({
                web: { title: `Source ${i}`, uri: `https://example.com/${i}` },
              })),
            ],
          },
        },
      ],
    });
    const result = await provider.answer("Question", config, context);
    expect(result.text).toContain(
      "Grounded answer\n\nSources:\n1. ACME overview\n2. ACME docs\n   https://example.com/docs",
    );
    expect(result.text).not.toContain("vertexaisearch.cloud.google.com");
    expect(result.text).not.toContain("Source 3");
    expect(result.itemCount).toBe(5);
  });
});

describe("Gemini HTTP research", () => {
  it("submits background research with an idempotency header", async () => {
    const fetchMock = mockResponse({ id: "research-1" });
    const result = await provider.startResearch("Investigate ACME", config, {
      ...context,
      idempotencyKey: "stable-key",
    });
    expect(result).toEqual({ id: "research-1" });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${base}interactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": "literal-key",
        "Idempotency-Key": "stable-key",
      },
      body: JSON.stringify({
        input: "Investigate ACME",
        agent: "deep-research-preview-04-2026",
        background: true,
      }),
      signal: undefined,
    });
  });

  it("forwards supported agent configuration", async () => {
    const fetchMock = mockResponse({ id: "research-1" });
    await provider.startResearch("Question", config, context, {
      agent_config: { thinking_summaries: "auto" },
    });
    expect(requestBody(fetchMock)).toEqual({
      agent_config: { type: "deep-research", thinking_summaries: "auto" },
      input: "Question",
      agent: "deep-research-preview-04-2026",
      background: true,
    });
  });

  it.each([
    [{ tools: [] }, "Unsupported Gemini research options: tools."],
    [
      { agent_config: { response_length: "short" } },
      "Unsupported Gemini agent_config options: response_length.",
    ],
    [
      { agent_config: { thinking_summaries: "invalid" } },
      "must be 'auto' or 'none'",
    ],
  ])(
    "rejects unsupported research options before fetching",
    async (options, message) => {
      const fetchMock = mockResponse({});
      await expect(
        provider.startResearch("Question", config, context, options),
      ).rejects.toThrow(message);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { id: "" }, { id: 42 }])(
    "rejects a missing interaction ID",
    async (payload) => {
      mockResponse(payload);
      await expect(
        provider.startResearch("Question", config, context),
      ).rejects.toThrow("missing an interaction ID");
    },
  );

  it("polls an encoded interaction ID without a body or idempotency header", async () => {
    const fetchMock = mockResponse({ status: "in_progress" });
    expect(
      await provider.pollResearch("job/with?special#chars", config, {
        ...context,
        idempotencyKey: "unused",
      }),
    ).toEqual({ status: "in_progress" });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}interactions/job%2Fwith%3Fspecial%23chars`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": "literal-key",
        },
        signal: undefined,
      },
    );
  });

  it("formats completed research from model-output steps only", async () => {
    mockResponse({
      status: "completed",
      steps: [
        { type: "user_input", content: [{ type: "text", text: "Question" }] },
        { type: "thought", content: [{ type: "text", text: "Private" }] },
        {
          type: "model_output",
          content: [
            { type: "text", text: " Report " },
            { type: "image" },
            { type: "text", text: "Conclusion" },
          ],
        },
      ],
    });
    expect(await provider.pollResearch("job", config, context)).toEqual({
      status: "completed",
      output: { provider: "gemini", text: "Report\n\nConclusion" },
    });
  });

  it.each([
    ["failed", { status: "failed", error: "research failed" }],
    ["cancelled", { status: "cancelled", error: "research was canceled" }],
    ["incomplete", { status: "failed", error: "research ended incomplete" }],
    [
      "requires_action",
      {
        status: "failed",
        error: "research requires additional action (function_call)",
      },
    ],
    ["running", { status: "in_progress", statusText: "running" }],
  ])("maps research status %s", async (status, expected) => {
    mockResponse({
      status,
      steps: [{ type: "user_input" }, { type: "function_call" }],
    });
    expect(await provider.pollResearch("job", config, context)).toEqual(
      expected,
    );
  });
});

describe("Gemini HTTP failures and cancellation", () => {
  const operations = [
    (ctx: ProviderContext) => provider.answer("Question", config, ctx),
    (ctx: ProviderContext) => provider.startResearch("Question", config, ctx),
    (ctx: ProviderContext) => provider.pollResearch("job", config, ctx),
  ];

  it.each(operations)(
    "forwards abort signals without retrying",
    async (operation) => {
      const controller = new AbortController();
      const error = new DOMException("Aborted", "AbortError");
      const fetchMock = vi.fn().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(error), {
              once: true,
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const pending = operation({ ...context, signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toBe(error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
      expect(asWebfoxError(error).code).toBe("CANCELLED");
    },
  );

  it.each([400, 401, 403, 408, 429, 500, 503])(
    "classifies HTTP %s without transport retries",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: "Request failed" } }, { status }),
        );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        provider.startResearch("Question", config, context),
      ).rejects.toMatchObject({
        code: "PROVIDER_FAILURE",
        message: `Gemini API request failed (${status}): Request failed`,
        options: { retryable: [408, 429, 500, 503].includes(status) },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("handles plain-text errors and bounds and redacts their details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(`literal-key ${"x".repeat(2000)}`, { status: 502 }),
        ),
    );
    const error = await provider
      .pollResearch("job", config, context)
      .catch(asWebfoxError);
    expect(error).toMatchObject({
      code: "PROVIDER_FAILURE",
      options: { retryable: true },
    });
    expect((error as Error).message).toContain("[redacted]");
    expect((error as Error).message).not.toContain("literal-key");
    expect((error as Error).message.length).toBeLessThan(1100);
  });

  it("rejects invalid JSON response shapes", async () => {
    mockResponse(null);
    await expect(
      provider.startResearch("Question", config, context),
    ).rejects.toThrow("invalid response");
  });

  it("rejects missing credentials before fetching", async () => {
    const fetchMock = mockResponse({});
    await expect(provider.answer("Question", {}, context)).rejects.toThrow(
      "missing an API key",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

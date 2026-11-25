import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox, type WebfoxConfig } from "../src/index.js";
import { stubFetch } from "./fetch-stub.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OpenAI provider", () => {
  it("uses structured outputs for web search", async () => {
    const calls = stubFetch(() => ({
      id: "resp_search_1",
      model: "gpt-4.1",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sources: [
                  {
                    title: "OpenAI Deep Research docs",
                    url: "https://platform.openai.com/docs/guides/deep-research",
                    snippet: "Official guide for OpenAI deep research.",
                  },
                ],
              }),
            },
          ],
        },
      ],
      error: null,
      incomplete_details: null,
    }));

    const result = await createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              search: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebfoxConfig,
    }).search({
      provider: "openai",
      options: {
        instructions: "Prefer official sources.",
        allowedDomains: ["platform.openai.com"],
        searchContextSize: "high",
        userLocation: {
          country: "US",
          region: "California",
        },
      },
      maxResults: 3,
      queries: ["openai deep research"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer literal-key",
        "idempotency-key": expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
      body: {
        model: "gpt-4.1",
        input: [
          "Search the public web and return only the most relevant sources for the user's query.",
          "Return at most 3 sources.",
          "Prefer official, primary, or highly reputable sources when available.",
          "Each snippet should be short, specific, and grounded in the retrieved source.",
          "Return only data matching the provided JSON schema.",
          "",
          "User query: openai deep research",
        ].join("\n"),
        tools: [
          {
            type: "web_search",
            filters: { allowed_domains: ["platform.openai.com"] },
            search_context_size: "high",
            user_location: {
              type: "approximate",
              country: "US",
              region: "California",
            },
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "openai_web_search_results",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["sources"],
              properties: {
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["title", "url", "snippet"],
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                    },
                  },
                },
              },
            },
            strict: true,
          },
        },
        instructions: "Prefer official sources.",
      },
    });
    expect(result.status).toBe("ok");
    expect(successful(result.results[0])?.results[0]).toMatchObject({
      title: "OpenAI Deep Research docs",
      url: "https://platform.openai.com/docs/guides/deep-research",
    });
  });

  it("uses web search for grounded answers and preserves citations", async () => {
    const calls = stubFetch(() => ({
      id: "resp_answer_1",
      model: "gpt-4.1",
      status: "completed",
      output: [
        {
          id: "msg_answer_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "OpenAI grounded answer",
              annotations: [
                {
                  type: "url_citation",
                  title: "Answer Source",
                  url: "https://example.com/answer",
                  start_index: 0,
                  end_index: 6,
                },
              ],
            },
          ],
        },
      ],
      error: null,
      incomplete_details: null,
    }));

    const result = await createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              answer: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebfoxConfig,
    }).answer({
      provider: "openai",
      options: {
        instructions: "Keep the answer concise and prefer primary sources.",
      },
      queries: ["What is the latest OpenAI deep research API?"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer literal-key" }),
      body: {
        model: "gpt-4.1",
        input: "What is the latest OpenAI deep research API?",
        tools: [{ type: "web_search" }],
        instructions: "Keep the answer concise and prefer primary sources.",
      },
    });
    expect(successful(result.results[0])).toMatchObject({
      text: "OpenAI grounded answer",
      sources: [{ url: "https://example.com/answer", title: "Answer Source" }],
    });
  });
});

describe("async research providers", () => {
  it("uses Exa deep-reasoning search to synthesize research", async () => {
    const calls = stubFetch(() => ({
      output: { content: "Exa research result" },
      results: [],
    }));

    const result = await createWebfox({
      config: {
        execution: { retries: 1 },
        providers: {
          exa: {
            credentials: { api: { value: "literal-key" } },
          },
        },
      } satisfies WebfoxConfig,
    }).research({
      provider: "exa",
      options: undefined,
      input: "Investigate Exa research polling",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.exa.ai/search",
      headers: { "x-api-key": "literal-key" },
    });
    expect(calls[0]?.body).toEqual({
      query: "Investigate Exa research polling",
      type: "deep-reasoning",
      outputSchema: { type: "text", description: expect.any(String) },
      contents: { text: { maxCharacters: 10_000 } },
    });
    expect(successful(result.results[0])?.text).toBe("Exa research result");
  });

  it("uses OpenAI background responses polling and preserves citations", async () => {
    vi.useFakeTimers();

    let gets = 0;
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, url, body });
        if (method === "POST") {
          return Response.json({ id: "resp_1" });
        }
        gets += 1;
        if (gets === 1) {
          throw Object.assign(new Error("connection reset"), {
            code: "ECONNRESET",
          });
        }
        return Response.json({
          id: "resp_1",
          model: "o3-deep-research",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "OpenAI research result",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "Source A",
                      url: "https://example.com/a",
                      start_index: 0,
                      end_index: 6,
                    },
                  ],
                },
              ],
            },
          ],
          error: null,
          incomplete_details: null,
        });
      }),
    );

    const promise = createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              research: {
                model: "o3-deep-research",
              },
            },
          },
        },
        execution: { retries: 1 },
      } satisfies WebfoxConfig,
    }).research({
      provider: "openai",
      options: {
        instructions: "Prefer primary sources.",
        max_tool_calls: 12,
      },
      input: "Investigate OpenAI deep research polling",
    });

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://api.openai.com/v1/responses",
        body: {
          model: "o3-deep-research",
          input: "Investigate OpenAI deep research polling",
          background: true,
          tools: [{ type: "web_search" }],
          instructions: "Prefer primary sources.",
          max_tool_calls: 12,
        },
      },
      { method: "GET", url: "https://api.openai.com/v1/responses/resp_1" },
      { method: "GET", url: "https://api.openai.com/v1/responses/resp_1" },
    ]);
    expect(successful(result.results[0])).toMatchObject({
      text: "OpenAI research result",
      sources: [{ url: "https://example.com/a", title: "Source A" }],
    });
  });

  it("uses Valyu polling so transient errors do not create duplicate jobs", async () => {
    vi.useFakeTimers();

    let gets = 0;
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, url, body });
        if (method === "POST") {
          return Response.json({
            success: true,
            deepresearch_id: "valyu-job-1",
          });
        }
        gets += 1;
        if (gets === 1) {
          throw Object.assign(new Error("connection reset"), {
            code: "ECONNRESET",
          });
        }
        return Response.json({
          success: true,
          status: "completed",
          output: "Valyu research result",
          sources: [
            {
              title: "Source A",
              url: "https://example.com/a",
            },
          ],
        });
      }),
    );

    const promise = createWebfox({
      config: {
        execution: { retries: 1 },
        providers: {
          valyu: {
            credentials: { api: { value: "literal-key" } },
          },
        },
      } satisfies WebfoxConfig,
    }).research({
      provider: "valyu",
      options: undefined,
      input: "Investigate Valyu research polling",
    });

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://api.valyu.ai/v1/deepresearch/tasks",
        body: {
          query: "Investigate Valyu research polling",
          mode: "fast",
          output_formats: ["markdown"],
        },
      },
      {
        method: "GET",
        url: "https://api.valyu.ai/v1/deepresearch/tasks/valyu-job-1/status",
      },
      {
        method: "GET",
        url: "https://api.valyu.ai/v1/deepresearch/tasks/valyu-job-1/status",
      },
    ]);
    expect(successful(result.results[0])).toMatchObject({
      text: "Valyu research result",
      sources: [{ url: "https://example.com/a", title: "Source A" }],
    });
  });
});

function successful<T>(result: import("../src/index.js").InputResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

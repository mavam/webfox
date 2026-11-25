import { afterEach, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { executeAsyncResearch } from "../src/runtime/polling.js";
import { WebfoxError } from "../src/errors.js";
import { providers } from "../src/providers/registry.js";
const { markdown } = vi.hoisted(() => ({ markdown: vi.fn() }));
vi.mock("cloudflare", () => ({
  default: class {
    browserRendering = { markdown: { create: markdown } };
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each([
  ["serpbase", undefined, undefined, 120_000],
  ["serpbase", 45_000, undefined, 45_000],
  ["serpbase", 45_000, 15_000, 15_000],
  ["serper", undefined, undefined, 30_000],
] as const)(
  "uses request > configuration > provider > global timeout for %s (%s, %s)",
  async (provider, configured, requested, expected) => {
    await providers[provider].load();
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), {
            once: true,
          });
        });
      }),
    );
    const client = createWebfox({
      config: { execution: { timeoutMs: configured } },
      env: { SERPBASE_API_KEY: "key", SERPER_API_KEY: "key" },
    });
    const pending = client.search({
      provider,
      queries: ["slow search"],
      timeoutMs: requested,
    });
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal!.aborted).toBe(true);
    expect((await pending).results[0]).toMatchObject({
      ok: false,
      error: { code: "TIMEOUT" },
    });
  },
);

it("retries structurally transient per-page failures on safe adapters", async () => {
  markdown
    .mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { status: 429 }),
    )
    .mockResolvedValueOnce("page");
  const client = createWebfox({
    config: { execution: { retries: 1, retryDelayMs: 0 } },
    env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
  });
  expect(
    (
      await client.contents({
        provider: "cloudflare",
        urls: ["https://example.test"],
      })
    ).results[0],
  ).toMatchObject({ ok: true, value: { content: "page" } });
  expect(markdown).toHaveBeenCalledTimes(2);
});
it("applies the runtime retry policy to polling without restarting jobs", async () => {
  const start = vi.fn().mockResolvedValue({ id: "job" });
  const poll = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    )
    .mockResolvedValueOnce({
      status: "completed",
      output: { text: "done" },
    });
  const context = { cwd: ".", retryPolicy: { retries: 1, delayMs: 0 } };
  await expect(
    executeAsyncResearch({
      providerLabel: "OpenAI",
      context,
      start,
      poll,
    }),
  ).resolves.toMatchObject({ text: "done" });
  expect(start).toHaveBeenCalledTimes(1);
  expect(poll).toHaveBeenCalledTimes(2);
  poll.mockRejectedValue(
    Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  );
  await expect(
    executeAsyncResearch({
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start,
      poll,
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  expect(poll).toHaveBeenCalledTimes(3);
});
it("bounds retries and backoff by one overall deadline", async () => {
  vi.useFakeTimers();
  let notifyFirstFetch!: () => void;
  const firstFetch = new Promise<void>((resolve) => {
    notifyFirstFetch = resolve;
  });
  const fetch = vi.fn().mockImplementation(async () => {
    notifyFirstFetch();
    return new Response("busy", { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  const client = createWebfox({
    config: { execution: { retries: 10, retryDelayMs: 60 } },
    env: { BRAVE_SEARCH_API_KEY: "key" },
  });
  const started = Date.now();
  const pending = client.search({
    provider: "brave",
    queries: ["test"],
    timeoutMs: 100,
  });
  // Wait for lazy adapter loading before advancing the simulated clock.
  await firstFetch;
  await vi.advanceTimersByTimeAsync(60);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(40);
  const result = await pending;
  expect(result.results[0]).toMatchObject({ error: { code: "TIMEOUT" } });
  expect(Date.now() - started).toBe(100);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("never retries research creation and preserves explicit terminal errors", async () => {
  const start = vi
    .fn()
    .mockRejectedValue(
      new WebfoxError("PROVIDER_FAILURE", "busy", { retryable: true }),
    );
  await expect(
    executeAsyncResearch({
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start,
      poll: vi.fn(),
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  expect(start).toHaveBeenCalledTimes(1);
  await expect(
    executeAsyncResearch({
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start: async () => ({ id: "job" }),
      poll: async () => ({ status: "cancelled", error: "stopped remotely" }),
    }),
  ).rejects.toMatchObject({ code: "CANCELLED" });
});

it("redacts secrets from other configured providers, credential defaults, and cached commands without corrupting response keys", async () => {
  const otherSecret = "sk-unrelated-provider-secret-999";
  const accountId = "cf-acct-secret-777";
  const commandSecret = "cmd-resolved-secret-555";
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ web: { results: [] } }))
    .mockResolvedValueOnce(
      new Response(`leaked ${otherSecret} ${accountId} ${commandSecret}`, {
        status: 500,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const client = createWebfox({
    config: {
      providers: {
        brave: {
          credentials: {
            search: {
              command: [
                process.execPath,
                "-e",
                `process.stdout.write(${JSON.stringify(commandSecret)})`,
              ],
            },
          },
        },
        custom: {
          options: {
            search: { value: "results" },
          },
        },
      },
    },
    env: {
      OPENAI_API_KEY: otherSecret,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      OLLAMA_API_KEY: "ollama-key",
    },
  });
  const first = await client.search({ provider: "brave", queries: ["ok"] });
  expect(first.status).toBe("ok");
  expect(first.results[0]).toMatchObject({ ok: true, value: { results: [] } });

  const second = await client.search({ provider: "ollama", queries: ["test"] });
  expect(second.results[0]).toMatchObject({ ok: false });
  if (second.results[0].ok) throw new Error("expected failure");
  expect(second.results[0].error.message).not.toContain(otherSecret);
  expect(second.results[0].error.message).not.toContain(accountId);
  expect(second.results[0].error.message).not.toContain(commandSecret);
  expect(second.results[0].error.message).toContain("[redacted]");
});

it("clamps maxResults to provider capability limits centrally", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [] }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createWebfox({
    config: {},
    env: { OLLAMA_API_KEY: "test-key" },
  });
  await client.search({
    provider: "ollama",
    queries: ["test"],
    maxResults: 50,
  });
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
    query: "test",
    max_results: 10,
  });
});

it("supplies a per-input idempotency key to adapters", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: "job-1" }))
    .mockResolvedValueOnce(
      Response.json({
        status: "completed",
        outputs: [{ type: "text", text: "Done" }],
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const client = createWebfox({
    config: {},
    env: { GOOGLE_API_KEY: "test-key" },
  });
  const doc = await client.research({
    provider: "gemini",
    input: "Topic",
  });
  expect(doc.status).toBe("ok");
  expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).toMatch(
    /^[0-9a-f-]{36}$/i,
  );
});

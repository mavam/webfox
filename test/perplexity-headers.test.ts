import { afterEach, expect, it, vi } from "vitest";
import { perplexityProvider } from "../src/providers/perplexity/definition.js";
import { providerHarness } from "./provider-harness.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  { name: "default API", expected: "webfox" },
  { name: "blank environment URL", envUrl: "   ", expected: "webfox" },
  {
    name: "environment API URL",
    envUrl: " https://api.perplexity.ai ",
    expected: "webfox",
  },
  {
    name: "environment proxy",
    envUrl: "https://proxy.example.com",
    expectedUrl: "https://proxy.example.com/search",
  },
  {
    name: "explicit API overrides environment proxy",
    baseUrl: "https://api.perplexity.ai",
    envUrl: "https://proxy.example.com",
    expected: "webfox",
  },
  {
    name: "explicit proxy overrides environment API",
    baseUrl: "http://127.0.0.1:8080",
    envUrl: "https://api.perplexity.ai",
    expectedUrl: "http://127.0.0.1:8080/search",
  },
  {
    name: "lookalike host",
    baseUrl: "https://api.perplexity.ai.example.com",
    expectedUrl: "https://api.perplexity.ai.example.com/search",
  },
  {
    name: "mixed-case caller override",
    customHeaders: "X-Other: preserved\nX-pPlX-iNtEgRaTiOn: my-app",
    expected: "my-app",
  },
  {
    name: "unrelated caller header",
    customHeaders: "X-Other: preserved",
    expected: "webfox",
  },
])(
  "preserves SDK header behavior for $name",
  async ({ baseUrl, envUrl, customHeaders, expected, expectedUrl }) => {
    vi.stubEnv("PERPLEXITY_BASE_URL", envUrl);
    vi.stubEnv("PERPLEXITY_CUSTOM_HEADERS", customHeaders);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await providerHarness(perplexityProvider).search(
      "q",
      1,
      { baseUrl, credentials: { api: "test-key" } },
      { cwd: process.cwd() },
      {},
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(expectedUrl ?? "https://api.perplexity.ai/search");
    const headers = new Headers(init?.headers);
    if (expected) {
      expect(headers.get("x-pplx-integration")).toBe(expected);
    } else {
      // Custom hosts retain the SDK's existing attribution, not webfox's.
      expect(headers.get("x-pplx-integration")).toMatch(/^perplexity-node\//);
    }
    expect(headers.get("authorization")).toBe("Bearer test-key");
    if (customHeaders) expect(headers.get("x-other")).toBe("preserved");
  },
);

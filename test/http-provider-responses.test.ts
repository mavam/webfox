import { afterEach, expect, it, vi } from "vitest";
import { exaProvider } from "../src/providers/exa/definition.js";
import { firecrawlProvider } from "../src/providers/firecrawl/definition.js";
import { linkupProvider } from "../src/providers/linkup/definition.js";
import { stubFetch } from "./fetch-stub.js";
import { providerHarness } from "./provider-harness.js";

const config = { credentials: { api: "literal-key" } };
const context = { cwd: process.cwd() };

afterEach(() => {
  vi.unstubAllGlobals();
});

it("rejects successful Exa responses that are not JSON", async () => {
  stubFetch(
    () =>
      new Response("<html>maintenance</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );

  await expect(
    providerHarness(exaProvider).search("q", 3, config, context),
  ).rejects.toThrow(/non-JSON body \(status 200\): <html>maintenance/);
  await expect(
    providerHarness(exaProvider).answer("q", config, context),
  ).rejects.toThrow(/non-JSON body/);
});

it("rejects successful Linkup responses with an empty body", async () => {
  stubFetch(() => new Response(null, { status: 200 }));

  await expect(
    providerHarness(linkupProvider).search("q", 3, config, context),
  ).rejects.toThrow(/empty body \(status 200\)/);
});

it("accepts Firecrawl's success envelope with a null error and bare URLs", async () => {
  stubFetch(() => ({
    success: true,
    error: null,
    data: { web: ["https://example.com"] },
  }));

  const response = await providerHarness(firecrawlProvider).search(
    "q",
    3,
    config,
    context,
  );

  expect(response.results).toEqual([
    {
      title: undefined,
      url: "https://example.com",
      snippet: "",
      metadata: undefined,
    },
  ]);
});

it("rejects Firecrawl responses without a success envelope", async () => {
  stubFetch(() => ({ message: "upstream failure" }));

  await expect(
    providerHarness(firecrawlProvider).search("q", 3, config, context),
  ).rejects.toThrow("upstream failure");

  const contents = await providerHarness(firecrawlProvider).contents(
    ["https://example.com"],
    config,
    context,
  );
  expect(contents.answers).toMatchObject([
    { url: "https://example.com", error: { message: "upstream failure" } },
  ]);
});

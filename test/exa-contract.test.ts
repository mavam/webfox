import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Type, type TObject } from "typebox";
import { createWebfox } from "../src/index.js";
import { optionSchema } from "../src/configuration/planning.js";
import { exaProvider } from "../src/providers/exa/definition.js";
import { prepareToolArguments } from "../src/pi-validation.js";

const requests: Array<{ path: string; body: Record<string, any> }> = [];
let response: unknown;
let status = 200;
let baseUrl: string;
const server = createServer(async (request, reply) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const parsed = JSON.parse(body);
  requests.push({ path: request.url!, body: parsed });
  reply.writeHead(status, { "content-type": "application/json" });
  reply.end(
    JSON.stringify(
      typeof response === "function" ? response(parsed) : response,
    ),
  );
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  requests.length = 0;
  status = 200;
  response = {
    results: [{ title: "Source", url: "https://example.com", text: "Excerpt" }],
  };
});
function client() {
  return createWebfox({
    config: {
      execution: { retries: 1 },
      providers: {
        exa: {
          baseUrl,
          credentials: { api: { value: "local-test-key" } },
        },
      },
    },
    env: {},
  });
}

const cutoff = "2026-07-01T00:00:00Z";

it.each(["auto", "fast", "instant"])(
  "forwards snapshot search with type %s through the real Exa SDK",
  async (type) => {
    const result = await client().search({
      provider: "exa",
      queries: ["historical query"],
      options: { type, contents: { snapshotAsOf: cutoff } },
    });
    expect(result.status).toBe("ok");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/search",
      body: { type, contents: { text: true, snapshotAsOf: cutoff } },
    });
    expect(requests[0].body).not.toHaveProperty("snapshotAsOf");
  },
);

it("forwards contents snapshots and preserves gaps for omitted pages", async () => {
  const missing = "https://missing.example.com";
  const found = "https://example.com";
  response = ({ urls }: { urls: string[] }) => ({
    results: urls.includes(found)
      ? [{ id: found, url: found, text: "Historical text" }]
      : [],
    statuses: urls.map((id) =>
      id === missing
        ? { id, status: "error", tag: "CONTENT_NOT_CACHED" }
        : { id, status: "success", source: "cached" },
    ),
  });
  const result = await client().contents({
    provider: "exa",
    urls: [missing, found],
    options: { snapshotAsOf: cutoff, text: true },
  });
  expect(requests).toHaveLength(2);
  expect(requests).toEqual(
    expect.arrayContaining(
      [missing, found].map((url) => ({
        path: "/contents",
        body: { urls: [url], snapshotAsOf: cutoff, text: true },
      })),
    ),
  );
  expect(result.status).toBe("partial");
  expect(result.results[0]).toMatchObject({ ok: false });
  expect(result.results[1]).toMatchObject({
    ok: true,
    value: { url: found, content: "Historical text" },
  });
});

it.each([42, null, ""])(
  "rejects invalid snapshot values before contacting Exa: %j",
  async (snapshotAsOf) => {
    await expect(
      client().search({
        provider: "exa",
        queries: ["q"],
        options: { contents: { snapshotAsOf } },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      client().contents({
        provider: "exa",
        urls: ["https://example.com"],
        options: { snapshotAsOf },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(requests).toEqual([]);
  },
);

it("exposes snapshot options and restrictions in model-facing metadata", () => {
  const search = optionSchema(exaProvider, "search")!;
  const contents = optionSchema(exaProvider, "contents")!;
  expect(
    (search.properties.contents as TObject).properties.snapshotAsOf,
  ).toMatchObject({
    type: "string",
    description: expect.stringContaining("ISO datetime"),
  });
  expect(contents.properties.snapshotAsOf).toEqual(
    (search.properties.contents as TObject).properties.snapshotAsOf,
  );
  expect(() =>
    prepareToolArguments(Type.Object({ options: search }), {
      options: { snapshotAsOf: cutoff },
    }),
  ).toThrow("Use options.contents.snapshotAsOf instead.");
  expect(
    exaProvider.capabilities.search!.promptGuidelines!.join(" "),
  ).toContain("Snapshot bounds content, not ranking");
  expect(
    exaProvider.capabilities.contents!.promptGuidelines!.join(" "),
  ).toContain("options.snapshotAsOf");
});

it.each([-1, 0, 24, 720])(
  "forwards nested freshness %i through the real Exa SDK",
  async (maxAgeHours) => {
    const result = await client().search({
      provider: "exa",
      queries: ["query"],
      maxResults: 5,
      options: { contents: { text: { maxCharacters: 3000 }, maxAgeHours } },
    });
    expect(result.status).toBe("ok");
    expect(requests).toEqual([
      {
        path: "/search",
        body: {
          query: "query",
          type: "auto",
          numResults: 5,
          contents: { text: { maxCharacters: 3000 }, maxAgeHours },
        },
      },
    ]);
  },
);

it.each([
  { maxAgeHours: 0 },
  { contents: { livecrawl: "always", maxAgeHours: 0 } },
  { contents: { maxAgeHours: -2 } },
  { contents: { maxAgeHours: 0.5 } },
  { contents: { maxAgeHours: 721 } },
  { contents: { livecrawlTimeout: 0 } },
  { contents: { livecrawlTimeout: 90001 } },
  { startCrawlDate: "2026-01-01" },
])(
  "rejects unsupported freshness options before contacting Exa: %j",
  async (options) => {
    await expect(
      client().search({ provider: "exa", queries: ["query"], options }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(requests).toEqual([]);
  },
);

it("guides misplaced freshness into contents and omits deprecated controls", () => {
  const options = optionSchema(exaProvider, "search")!;
  const schema = Type.Object({ queries: Type.Array(Type.String()), options });
  expect(() =>
    prepareToolArguments(schema, {
      queries: ["q"],
      options: { maxAgeHours: 0 },
    }),
  ).toThrow(
    "Invalid parameter: options.maxAgeHours. Use options.contents.maxAgeHours instead.",
  );
  expect(
    (options.properties.contents as TObject).properties,
  ).not.toHaveProperty("livecrawl");
  expect(options.properties).not.toHaveProperty("startCrawlDate");
  expect(
    exaProvider.capabilities.search!.promptGuidelines!.join(" "),
  ).toContain("Remove livecrawl rather than moving it");
});

it("uses /search, not retired /research, and preserves the synthesized report and sources", async () => {
  response = {
    output: { content: "# Research report\n\nFindings." },
    results: [{ title: "Source", url: "https://example.com" }],
  };
  const result = await client().research({
    provider: "exa",
    input: "research question",
  });
  expect(result.results[0]).toMatchObject({
    ok: true,
    value: {
      text: "# Research report\n\nFindings.\n\nSources:\n1. Source\n   https://example.com",
      itemCount: 1,
    },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/search",
    body: {
      query: "research question",
      type: "deep-reasoning",
      outputSchema: { type: "text" },
    },
  });
});

it("does not silently succeed without a synthesized report", async () => {
  const result = await client().research({
    provider: "exa",
    input: "question",
  });
  expect(result.results[0]).toMatchObject({
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Exa returned no research report.",
    },
  });
  expect(requests).toHaveLength(1);
});

it("does not repeat a failed research request", async () => {
  status = 503;
  response = { error: "unavailable" };
  const result = await client().research({
    provider: "exa",
    input: "question",
  });
  expect(result.status).toBe("partial");
  expect(requests).toHaveLength(1);
});

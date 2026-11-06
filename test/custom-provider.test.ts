import { expect, it } from "vitest";
import { createWebfox } from "../src/index.js";
import { customConfig } from "./helpers.js";
it.each([
  [{ url: "https://test", content: "page" }],
  [{ inputIndex: -1, url: "https://test", content: "page" }],
  [{ inputIndex: 1, url: "https://test", content: "page" }],
  [
    { inputIndex: 0, url: "https://test", content: "page" },
    { inputIndex: 0, url: "https://test", content: "page" },
  ],
])(
  "rejects missing, out-of-range, and duplicate contents indexes (%#)",
  async (...answers) => {
    const config = customConfig();
    config.providers!.custom!.commands!.contents!.argv = [
      process.execPath,
      "-e",
      `console.log(${JSON.stringify(JSON.stringify({ answers }))})`,
    ];
    const result = await createWebfox({ config }).contents({
      urls: ["https://test"],
    });
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_FAILURE" },
    });
  },
);
it("keeps completed contents when another URL exceeds the deadline", async () => {
  const result = await createWebfox({ config: customConfig() }).contents({
    urls: ["https://fast.test", "https://slow.test"],
    timeoutMs: 250,
  });
  expect(result.results[0]).toMatchObject({
    input: "https://fast.test",
    ok: true,
  });
  expect(result.results[1]).toMatchObject({
    input: "https://slow.test",
    ok: false,
    error: { code: "TIMEOUT" },
  });
});
it("smokes all four custom-provider operations through the public API", async () => {
  const client = createWebfox({ config: customConfig() });
  expect((await client.search({ queries: ["custom"] })).status).toBe("ok");
  expect(
    (await client.contents({ urls: ["https://example.test"] })).status,
  ).toBe("ok");
  expect((await client.answer({ queries: ["custom"] })).status).toBe("ok");
  expect((await client.research({ input: "custom" })).status).toBe("ok");
});
it.each([
  [
    { text: "", sources: [{ url: "https://a.test", title: "A" }] },
    {
      ok: true,
      value: {
        text: "",
        sources: [{ url: "https://a.test", title: "A" }],
        itemCount: 1,
      },
    },
  ],
  [
    { text: "x", sources: [{}, { title: " " }, { url: " u ", title: "u" }] },
    { ok: true, value: { text: "x", sources: [{ url: "u", title: "u" }] } },
  ],
  [
    { text: "x", sources: [{ url: 1 }] },
    { ok: false, error: { code: "PROVIDER_FAILURE" } },
  ],
  [
    { text: "x", sources: "a" },
    { ok: false, error: { code: "PROVIDER_FAILURE" } },
  ],
])("parses custom answer sources (%#)", async (output, expected) => {
  const config = customConfig();
  config.providers!.custom!.commands!.answer!.argv = [
    process.execPath,
    "-e",
    `console.log(${JSON.stringify(JSON.stringify(output))})`,
  ];
  const result = await createWebfox({ config }).answer({ queries: ["q"] });
  expect(result.results[0]).toMatchObject(expected);
});
it.each([
  [{ inputIndex: 0, url: "https://test" }],
  [{ inputIndex: 0, url: "https://test", content: " " }],
])("accepts an empty custom page (%#)", async (answer) => {
  const config = customConfig();
  config.providers!.custom!.commands!.contents!.argv = [
    process.execPath,
    "-e",
    `console.log(${JSON.stringify(JSON.stringify({ answers: [answer] }))})`,
  ];
  const result = await createWebfox({ config }).contents({
    urls: ["https://test"],
  });
  expect(result.results[0]).toEqual({
    input: "https://test",
    ok: true,
    value: { url: "https://test" },
  });
});
it("omits blank custom search titles", async () => {
  const config = customConfig();
  const results = [
    { url: "https://a.test", snippet: "" },
    { title: " ", url: "https://b.test", snippet: "" },
    { title: " B ", url: "https://c.test", snippet: "" },
  ];
  config.providers!.custom!.commands!.search!.argv = [
    process.execPath,
    "-e",
    `console.log(${JSON.stringify(JSON.stringify({ results }))})`,
  ];
  const result = await createWebfox({ config }).search({ queries: ["q"] });
  expect(result.results[0]).toMatchObject({
    ok: true,
    value: {
      results: [
        { url: "https://a.test", snippet: "" },
        { url: "https://b.test", snippet: "" },
        { title: "B", url: "https://c.test", snippet: "" },
      ],
    },
  });
  if (result.results[0].ok)
    expect(result.results[0].value.results[0]).not.toHaveProperty("title");
});

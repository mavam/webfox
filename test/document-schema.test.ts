import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { DOCUMENT_SCHEMAS } from "../src/document-schema.js";
import {
  CAPABILITIES,
  createWebfox,
  type Capability,
  type WebDocument,
} from "../src/index.js";
import { customConfig } from "./helpers.js";

const client = createWebfox({ config: customConfig() });
const run: Record<Capability, (fail: boolean) => Promise<WebDocument>> = {
  search: (fail) =>
    client.search({ queries: ["fine", ...(fail ? ["fail"] : [])] }),
  contents: (fail) =>
    client.contents({
      urls: ["https://fine.test", ...(fail ? ["https://error.test"] : [])],
    }),
  answer: (fail) =>
    client.answer({ queries: ["fine", ...(fail ? ["fail"] : [])] }),
  research: (fail) => client.research({ input: fail ? "fail" : "fine" }),
};

describe.each(CAPABILITIES)("%s document schema", (capability) => {
  const schema = DOCUMENT_SCHEMAS[capability];

  it("accepts complete documents", async () => {
    const document = await run[capability](false);
    expect(document.status).toBe("ok");
    expect(Check(schema, document)).toBe(true);
  });

  it("accepts partial documents that carry failed inputs", async () => {
    const document = await run[capability](true);
    expect(document.status).toBe("partial");
    expect(document.results.some((entry) => !entry.ok)).toBe(true);
    expect(Check(schema, document)).toBe(true);
  });

  it("accepts the document after a JSON round trip", async () => {
    const document = JSON.parse(JSON.stringify(await run[capability](true)));
    expect(Check(schema, document)).toBe(true);
  });

  it("rejects malformed documents", async () => {
    const document = JSON.parse(JSON.stringify(await run[capability](true)));
    const other = CAPABILITIES.find((entry) => entry !== capability)!;
    const malformed: Record<string, unknown> = {
      "another capability": { ...document, capability: other },
      "an unknown provider": { ...document, provider: "nope" },
      "an unknown status": { ...document, status: "failed" },
      "an unknown schema version": { ...document, schemaVersion: 2 },
      "an unknown field": { ...document, extra: true },
      "missing results": { ...document, results: undefined },
      "an entry without a discriminator": {
        ...document,
        results: [{ input: "x" }],
      },
      "a failed entry without an error": {
        ...document,
        results: [{ input: "x", ok: false }],
      },
      "an entry with both a value and an error": {
        ...document,
        results: [
          {
            input: "x",
            ok: false,
            value: {},
            error: { code: "TIMEOUT", message: "late" },
          },
        ],
      },
      "an unknown error code": {
        ...document,
        results: [
          { input: "x", ok: false, error: { code: "NOPE", message: "m" } },
        ],
      },
    };
    for (const [name, value] of Object.entries(malformed))
      expect(Check(schema, value), name).toBe(false);
  });
});

it("distinguishes the value shape of each capability", async () => {
  const documents = Object.fromEntries(
    await Promise.all(
      CAPABILITIES.map(async (capability) => [
        capability,
        await run[capability](false),
      ]),
    ),
  ) as Record<Capability, WebDocument>;
  // Retagging keeps the shared envelope but not the capability's value.
  expect(
    Check(DOCUMENT_SCHEMAS.search, {
      ...documents.contents,
      capability: "search",
    }),
  ).toBe(false);
  expect(
    Check(DOCUMENT_SCHEMAS.contents, {
      ...documents.answer,
      capability: "contents",
    }),
  ).toBe(false);
  // Answers and research briefs share one value shape.
  expect(
    Check(DOCUMENT_SCHEMAS.research, {
      ...documents.answer,
      capability: "research",
    }),
  ).toBe(true);
});

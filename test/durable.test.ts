import { expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  ToolResultEntry,
} from "@earendil-works/pi-durable";
import {
  err,
  FileError,
  ok,
  type ExecutionEnv,
} from "@earendil-works/pi-durable/env";
import { Type } from "typebox";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createWebfoxExtension } from "../src/durable.js";
import { customConfig } from "./helpers.js";

it("offers all configured capabilities as durable tools with the web namespace and structured output", () => {
  const extension = createWebfoxExtension({ config: customConfig() });
  expect(extension.namespace).toEqual({
    name: "web",
    description: "Search, extract pages, answer, and research the web.",
  });
  expect(extension.tools?.map((tool) => tool.name)).toEqual([
    "web_search",
    "web_contents",
    "web_answer",
    "web_research",
  ]);
  expect(extension.tools?.every((tool) => tool.replay === "unsafe")).toBe(true);
  expect(
    extension.tools?.every((tool) => Boolean(tool.structuredOutputSchema)),
  ).toBe(true);
});

it("runs the existing provider through the durable harness and preserves partial failure and structured output", async () => {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  let nestedStructured: unknown;
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("web_search", { queries: ["ok", "fail"] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("probe_nested", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done."),
  ]);
  const registry = createRegistry();
  registry.install(createWebfoxExtension({ config: customConfig() }));
  registry.install(
    defineExtension({
      name: "probe",
      tools: [
        defineTool({
          name: "probe_nested",
          description: "Invoke web_search as a nested call",
          parameters: Type.Object({}),
          async execute(_args, api, ctx) {
            const nested = await api.executeTool(
              "web_search",
              { queries: ["nested"] },
              ctx,
            );
            nestedStructured = nested.structuredOutput;
            return { output: [{ type: "text", text: "probed" }] };
          },
        }),
      ],
    }),
  );
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry,
      env: () => new NodeExecutionEnv({ cwd: process.cwd() }),
    },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const settled = await (
      await root.submit({ type: "input", content: "Search." }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    const entries = await root.entries({}, 20, undefined, context);
    const entry = entries.items.find(
      (item) =>
        ToolResultEntry.is(item) &&
        item.model?.[0]?.role === "toolResult" &&
        item.model[0].toolName === "web_search",
    );
    expect(entry?.model?.[0]?.role).toBe("toolResult");
    const message = entry?.model?.[0];
    if (message?.role !== "toolResult") throw new Error("Missing result");
    expect(
      message.content.some(
        (part) => part.type === "text" && part.text.includes("Result for ok"),
      ),
    ).toBe(true);
    expect(message.isError).toBe(true);
    expect(nestedStructured).toMatchObject({
      capability: "search",
      status: "ok",
      results: [
        {
          input: "nested",
          ok: true,
          value: { results: [{ title: "Result for nested" }] },
        },
      ],
    });
  } finally {
    await harness.close(context);
  }
});

it("writes truncated spill files through the conversation ExecutionEnv", async () => {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("web_contents", { urls: ["https://big.test"] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Done."),
  ]);

  const config = customConfig();
  config.providers!.custom!.commands!.contents!.argv = [
    process.execPath,
    "-e",
    `console.log(JSON.stringify({ answers: [{ inputIndex: 0, url: "https://big.test", content: Array.from({ length: 2500 }, (_, i) => "line " + i).join("\\n") }] }))`,
  ];

  const written = new Map<string, string>();
  const baseEnv = new NodeExecutionEnv({ cwd: process.cwd() });
  const env = new Proxy(baseEnv, {
    get(target, prop, receiver) {
      if (prop === "createTempDir") {
        return vi.fn(async (prefix: string | undefined) =>
          ok(`/virtual-tmp/${prefix ?? ""}123`),
        );
      }
      if (prop === "joinPath") {
        return vi.fn(async (parts: string[]) => ok(parts.join("/")));
      }
      if (prop === "writeFile") {
        return vi.fn(async (path: string, content: string | Uint8Array) => {
          written.set(path, String(content));
          return ok(undefined);
        });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ExecutionEnv;

  const registry = createRegistry();
  registry.install(createWebfoxExtension({ config }));
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry, env: () => env },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const settled = await (
      await root.submit({ type: "input", content: "Fetch big page." }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    const entries = await root.entries({}, 20, undefined, context);
    const entry = entries.items.find((item) => ToolResultEntry.is(item));
    const message = entry?.model?.[0];
    if (message?.role !== "toolResult") throw new Error("Missing result");
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain("Full results: /virtual-tmp/web-123/result.json");
    expect(text).not.toContain("line 2499");
    const spilled = JSON.parse(
      written.get("/virtual-tmp/web-123/result.json") ?? "{}",
    );
    expect(spilled.results[0].value.content).toContain("line 2499");
  } finally {
    await harness.close(context);
  }
});

it("preserves completed results and structuredOutput when spill-file creation is denied", async () => {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  let nestedStructured: unknown;
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("web_contents", { urls: ["https://big.test"] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("probe_big", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done."),
  ]);

  const config = customConfig();
  config.providers!.custom!.commands!.contents!.argv = [
    process.execPath,
    "-e",
    `console.log(JSON.stringify({ answers: [{ inputIndex: 0, url: "https://big.test", content: Array.from({ length: 2500 }, (_, i) => "line " + i).join("\\n") }] }))`,
  ];

  const baseEnv = new NodeExecutionEnv({ cwd: process.cwd() });
  const env = new Proxy(baseEnv, {
    get(target, prop, receiver) {
      if (prop === "createTempDir") {
        return vi.fn(async () =>
          err(new FileError("permission_denied", "sandbox read-only")),
        );
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ExecutionEnv;

  const registry = createRegistry();
  registry.install(createWebfoxExtension({ config }));
  registry.install(
    defineExtension({
      name: "probe",
      tools: [
        defineTool({
          name: "probe_big",
          description: "Invoke web_contents as a nested call",
          parameters: Type.Object({}),
          async execute(_args, api, ctx) {
            const nested = await api.executeTool(
              "web_contents",
              { urls: ["https://big.test"] },
              ctx,
            );
            nestedStructured = nested.structuredOutput;
            return { output: [{ type: "text", text: "probed" }] };
          },
        }),
      ],
    }),
  );
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry, env: () => env },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    });
    const settled = await (
      await root.submit({ type: "input", content: "Fetch big page." }, context)
    ).wait(context);
    expect(settled.status).toBe("done");
    const entries = await root.entries({}, 20, undefined, context);
    const entry = entries.items.find(
      (item) =>
        ToolResultEntry.is(item) &&
        item.model?.[0]?.role === "toolResult" &&
        item.model[0].toolName === "web_contents",
    );
    const message = entry?.model?.[0];
    if (message?.role !== "toolResult") throw new Error("Missing result");
    expect(message.isError).toBe(false);
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(text).toContain(
      "Full results could not be saved: sandbox read-only",
    );
    expect(nestedStructured).toMatchObject({
      capability: "contents",
      status: "ok",
      results: [
        {
          ok: true,
          value: { content: expect.stringContaining("line 2499") },
        },
      ],
    });
  } finally {
    await harness.close(context);
  }
});

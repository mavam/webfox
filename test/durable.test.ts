import { expect, it } from "vitest";
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

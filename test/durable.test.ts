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
  Harness,
  MemoryStorage,
  ToolResultEntry,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createWebfoxExtension } from "../src/durable.js";
import { customConfig } from "./helpers.js";

it("offers all configured capabilities as durable tools without replaying billed requests", () => {
  const extension = createWebfoxExtension({ config: customConfig() });
  expect(extension.tools?.map((tool) => tool.name)).toEqual([
    "web_search",
    "web_contents",
    "web_answer",
    "web_research",
  ]);
  expect(extension.tools?.every((tool) => tool.replay === "unsafe")).toBe(true);
});

it("runs the existing provider through the durable harness and preserves partial failure", async () => {
  const context = BACKGROUND_CONTEXT;
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("web_search", { queries: ["ok", "fail"] }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Done."),
  ]);
  const registry = createRegistry();
  registry.install(createWebfoxExtension({ config: customConfig() }));
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
    const entry = entries.items.find((item) => ToolResultEntry.is(item));
    expect(entry?.model?.[0]?.role).toBe("toolResult");
    const message = entry?.model?.[0];
    if (message?.role !== "toolResult") throw new Error("Missing result");
    expect(
      message.content.some(
        (part) => part.type === "text" && part.text.includes("ok"),
      ),
    ).toBe(true);
    expect(message.isError).toBe(true);
  } finally {
    await harness.close(context);
  }
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createAssistantMessageEventStream,
  getCurrentSystemMessage,
  type AssistantMessage,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import webExtension from "../src/pi.js";
import { customConfig } from "./helpers.js";

const paths: string[] = [];
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.abort();
    session.dispose();
  }
  vi.unstubAllEnvs();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createSession(
  config = customConfig(),
  mode: "on" | "only" = "on",
  observe?: ExtensionFactory,
) {
  const directory = await mkdtemp(join(tmpdir(), "webfox-codemode-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(path, stringify(config, { aliasDuplicateObjects: false }));
  vi.stubEnv("WEBFOX_CONFIG", path);
  const settingsManager = SettingsManager.inMemory({
    defaultTools: ["+codemode"],
    codemode: { mode },
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: "off",
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      webExtension,
      createCodemodeExtension({ models: false }),
      ...(observe ? [observe] : []),
    ],
  });
  await resourceLoader.reload();
  expect(resourceLoader.getExtensions().errors).toEqual([]);
  const modelRuntime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(directory, "models-store.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  // Authentication satisfies Pi's preflight only. The stream is replaced below.
  await modelRuntime.setRuntimeApiKey("anthropic", "unused-test-key");
  const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  if (!model) throw new Error("Missing test model");
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    model,
    modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(directory),
  });
  sessions.push(session);
  await session.bindExtensions({});
  return session;
}

async function runScript(session: AgentSession, code: string) {
  // Only the model is scripted: Pi executes codemode, QuickJS, argument
  // validation, hooks, and the real Webfox custom-provider subprocesses.
  let first = true;
  const declarations: { name: string; description: string }[] = [];
  session.agent.streamFunction = (model, context) => {
    const call = first;
    first = false;
    if (call)
      declarations.push(
        ...(getCurrentSystemMessage(context.messages)?.toolsAdded ?? []),
      );
    const message: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      stopReason: call ? "toolUse" : "stop",
      content: call
        ? [
            {
              type: "toolCall",
              id: "script",
              name: "codemode",
              arguments: { code },
            },
          ]
        : [{ type: "text", text: "Done" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
    return stream;
  };
  await session.prompt("Run the supplied codemode script.");
  const result = session.messages.find(
    (message): message is ToolResultMessage =>
      message.role === "toolResult" && message.toolName === "codemode",
  );
  if (!result) throw new Error("Missing codemode result");
  return { result, declarations };
}

function output(result: ToolResultMessage) {
  const last = result.content.at(-1);
  if (last?.type !== "text") throw new Error("Missing script output");
  return JSON.parse(last.text);
}

it.each(["on", "only"] as const)(
  "discovers the web namespace and chains structured calls in %s mode",
  async (mode) => {
    const nested: ToolResultEvent[] = [];
    const session = await createSession(customConfig(), mode, (pi) => {
      pi.on("tool_result", (event) => {
        if (event.parentToolCallId) nested.push(event);
      });
    });
    const { result, declarations } = await runScript(
      session,
      `
      const discovered = await searchTools("search", { namespace: "web", limit: 10 });
      const search = await tools.web_search({ queries: ["Node.js", "Bun"], maxResults: 3 });
      const urls = [...new Set(search.results.flatMap(entry =>
        entry.ok ? entry.value.results.map(hit => hit.url) : []
      ))].slice(0, 5);
      const pages = await tools.web_contents({ urls });
      const answers = await Promise.allSettled([
        tools.web_answer({ queries: ["cancellation"] }),
        tools.web_research({ input: "cancellation" }),
      ]);
      text({ discovered: discovered.map(tool => tool.name).sort(), search, pages, answers });
    `,
    );
    expect(result.isError).toBe(false);
    const data = output(result);
    expect(data.discovered).toEqual([
      "web_answer",
      "web_contents",
      "web_research",
      "web_search",
    ]);
    expect(data.search.capability).toBe("search");
    expect(
      data.search.results.map((entry: { input: string }) => entry.input),
    ).toEqual(["Node.js", "Bun"]);
    expect(
      data.pages.results.map(
        (entry: { value: { content: string } }) => entry.value.content,
      ),
    ).toEqual([
      "Contents of https://example.test/Node.js",
      "Contents of https://example.test/Bun",
    ]);
    expect(
      data.answers.map((entry: { status: string }) => entry.status),
    ).toEqual(["fulfilled", "fulfilled"]);
    expect(data.answers[0].value.results[0].value.text).toBe(
      "Answer for cancellation",
    );
    expect(data.answers[1].value.results[0].value.text).toBe(
      "Research for cancellation",
    );
    expect(nested.map((event) => event.toolName).sort()).toEqual(
      data.discovered,
    );
    expect(nested.every((event) => event.parentToolCallId === "script")).toBe(
      true,
    );
    // Intermediate calls are observed by hooks, not added to the transcript.
    expect(
      session.messages.filter((message) => message.role === "toolResult"),
    ).toEqual([result]);
    const webDeclarations = declarations.filter((tool) =>
      tool.name.startsWith("web_"),
    );
    expect(webDeclarations).toHaveLength(mode === "on" ? 4 : 0);
    if (mode === "only") {
      expect(
        declarations.find((tool) => tool.name === "codemode")?.description,
      ).toMatch(/^## web(?: \(|$)/m);
    }
    expect(session.getActiveToolNames()).toContain("web_search");
    expect(
      session.getAllTools().find((tool) => tool.name === "web_search")
        ?.exposure,
    ).toBe("direct");
  },
);

it("keeps partial and entirely failed batches available as structured values", async () => {
  const session = await createSession();
  const { result } = await runScript(
    session,
    `
    text(await tools.web_search({ queries: ["success", "fail"] }));
    text(await tools.web_answer({ queries: ["fail"] }));
  `,
  );
  expect(result.isError).toBe(false);
  const texts = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text);
  const documents = texts
    .filter((text) => text.startsWith("{"))
    .map((text) => JSON.parse(text));
  expect(documents).toHaveLength(2);
  expect(documents[0].status).toBe("partial");
  expect(
    documents[0].results.map((entry: { ok: boolean }) => entry.ok),
  ).toEqual([true, false]);
  expect(documents[0].results[0].value.results[0].title).toBe(
    "Result for success",
  );
  expect(documents[1].status).toBe("partial");
  expect(documents[1].results[0].error.code).toBe("PROVIDER_FAILURE");
});

it("receives full intermediate contents and emits only selected evidence", async () => {
  const config = customConfig();
  config.providers!.custom!.commands!.contents!.argv = [
    process.execPath,
    "-e",
    `console.log(JSON.stringify({ answers: [{ inputIndex: 0, url: "https://big.test", content: Array.from({ length: 5000 }, (_, i) => "line " + i).join("\\n") }] }))`,
  ];
  const nested: ToolResultEvent[] = [];
  const session = await createSession(config, "on", (pi) => {
    pi.on("tool_result", (event) => {
      if (event.toolName === "web_contents") {
        nested.push(event);
        const details = event.details as { fullOutputPath?: string };
        if (details.fullOutputPath) paths.push(dirname(details.fullOutputPath));
      }
    });
  });
  const { result } = await runScript(
    session,
    `
    const pages = await tools.web_contents({ urls: ["https://big.test"] });
    const content = pages.results[0].value.content;
    text({ lines: content.split("\\n").length, last: content.split("\\n").at(-1) });
  `,
  );
  expect(result.isError).toBe(false);
  expect(output(result)).toEqual({ lines: 5000, last: "line 4999" });
  expect(nested).toHaveLength(1);
  const text = nested[0].content.find((block) => block.type === "text")?.text;
  expect(text).toContain("Full results:");
  expect(text).not.toContain("line 4999");
  const details = nested[0].details as { fullOutputPath: string };
  const saved = JSON.parse(await readFile(details.fullOutputPath, "utf8"));
  expect(saved.results[0].value.content).toContain("line 4999");
  // Neither the full result nor the truncated rendering enters the transcript.
  expect(JSON.stringify(session.messages)).not.toContain("line 2500");
  expect(JSON.stringify(session.messages)).not.toContain("Full results:");
});

it.each([
  ["on", false],
  ["on", true],
  ["only", false],
  ["only", true],
] as const)(
  "respects result redaction in %s mode with structured replacement=%s",
  async (mode, replaceStructured) => {
    const secret = "provider-only-secret";
    const redactedText = "[redacted]";
    const config = customConfig();
    config.providers!.custom!.commands!.contents!.argv = [
      process.execPath,
      "-e",
      `console.log(JSON.stringify({ answers: [{ inputIndex: 0, url: "https://example.test", content: "${secret}" }] }))`,
    ];
    let original: unknown;
    const nested: ToolResultEvent[] = [];
    const session = await createSession(config, mode, (pi) => {
      pi.on("tool_result", (event) => {
        if (event.toolName !== "web_contents") return;
        original = event.structuredContent;
        const redacted = JSON.parse(JSON.stringify(original));
        redacted.results[0].value.content = redactedText;
        return {
          content: [{ type: "text", text: redactedText }],
          details: {},
          ...(replaceStructured ? { structuredContent: redacted } : {}),
        };
      });
      // Observe the post-redaction result seen by later hooks.
      pi.on("tool_result", (event) => {
        if (event.toolName === "web_contents") nested.push(event);
      });
    });
    const { result } = await runScript(
      session,
      'text({ value: await tools.web_contents({ urls: ["https://example.test"] }) });',
    );
    expect(JSON.stringify(original)).toContain(secret);
    expect(result.isError).toBe(false);
    expect(nested).toHaveLength(1);
    expect(nested[0].content).toEqual([{ type: "text", text: redactedText }]);
    expect(nested[0].details).toEqual({});
    if (replaceStructured) {
      const document = output(result).value;
      expect(document.capability).toBe("contents");
      expect(document.results[0].value.content).toBe(redactedText);
      expect(nested[0].structuredContent).toEqual(document);
    } else {
      // Pi drops structured data when a hook replaces only the text.
      expect(nested[0].structuredContent).toBeUndefined();
      expect(output(result)).toEqual({ value: redactedText });
    }
    expect(JSON.stringify(nested)).not.toContain(secret);
    expect(JSON.stringify(session.messages)).not.toContain(secret);
  },
);

it("rejects invalid and permission-blocked nested calls without invoking providers", async () => {
  const executed: string[] = [];
  const session = await createSession(customConfig(), "on", (pi) => {
    pi.on("tool_call", (event) => {
      if (event.toolName === "web_answer")
        return { block: true, reason: "Denied by test policy" };
    });
    pi.on("tool_result", (event) => {
      if (event.parentToolCallId) executed.push(event.toolName);
    });
  });
  const { result } = await runScript(
    session,
    `
    const attempts = await Promise.allSettled([
      tools.web_search({ queries: [] }),
      tools.web_answer({ queries: ["blocked"] }),
    ]);
    text(attempts.map(entry => ({ status: entry.status, error: String(entry.reason) })));
  `,
  );
  expect(result.isError).toBe(false);
  const attempts = output(result);
  expect(attempts.map((entry: { status: string }) => entry.status)).toEqual([
    "rejected",
    "rejected",
  ]);
  expect(attempts[0].error).toMatch(/queries|minItems|at least/i);
  expect(attempts[1].error).toContain("Denied by test policy");
  expect(executed).toEqual([]);
});

it("propagates session cancellation to an in-flight provider", async () => {
  const config = customConfig();
  config.providers!.custom!.commands!.search!.argv = [
    process.execPath,
    "-e",
    // A progress line proves the real subprocess has started before aborting.
    'process.stderr.write("provider ready\\n"); setTimeout(() => console.log("{}"), 30000)',
  ];
  const nested: ToolResultEvent[] = [];
  const session = await createSession(config, "on", (pi) => {
    pi.on("tool_result", (event) => {
      if (event.toolName === "web_search") nested.push(event);
    });
  });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  session.subscribe((event) => {
    if (
      event.type !== "tool_execution_update" ||
      event.toolName !== "web_search"
    )
      return;
    const update = event.partialResult as Pick<ToolResultMessage, "content">;
    if (
      update.content.some(
        (block) =>
          block.type === "text" && block.text.includes("provider ready"),
      )
    )
      ready();
  });
  const running = runScript(
    session,
    'text(await tools.web_search({ queries: ["slow"] }));',
  );
  await started;
  await session.abort();
  const { result } = await running;
  expect(result.isError).toBe(true);
  expect(nested).toHaveLength(1);
  const document = nested[0].structuredContent as {
    results: { error: { code: string } }[];
  };
  expect(document.results[0].error.code).toBe("CANCELLED");
  expect(session.isStreaming).toBe(false);
}, 10000);

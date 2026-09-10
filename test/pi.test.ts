import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import webExtension from "../src/pi.js";
import { customConfig } from "./helpers.js";
import { Check } from "typebox/value";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  keyText: () => "ctrl+o",
}));
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("uses application inspection and execution and marks partial tool results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webfox-pi-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(
    path,
    stringify(customConfig(), { aliasDuplicateObjects: false }),
  );
  vi.stubEnv("WEBFOX_CONFIG", path);
  const tools: any[] = [];
  const events: Record<string, (...args: any[]) => any> = {};
  webExtension({
    registerTool: (tool: any) => tools.push(tool),
    on: (name: string, handler: any) => {
      events[name] = handler;
    },
  } as any);
  expect(tools.map((tool) => tool.name)).toEqual([
    "web_search",
    "web_contents",
    "web_answer",
    "web_research",
  ]);
  expect(tools.map((tool) => tool.label)).toEqual([
    "Web Search",
    "Web Contents",
    "Web Answer",
    "Web Research",
  ]);
  expect(JSON.stringify(tools)).not.toMatch(/fox|mux/i);
  const theme = {
    fg: vi.fn((_color, text) => text),
    bold: vi.fn((text) => text),
  };
  for (const tool of tools) {
    const expected = tool.name.replace("_", " ");
    const component = tool.renderCall({}, theme, {});
    expect(component.render(80).join("\n").trimEnd()).toMatch(
      new RegExp(`^${expected} \\(.+ to expand\\)$`),
    );
    expect(theme.fg).toHaveBeenCalledWith("toolTitle", expected);
    expect(theme.bold).toHaveBeenCalledWith(expected);
    expect(tool.renderCall({}, theme, { lastComponent: component })).toBe(
      component,
    );
    for (const line of component.render(6))
      expect(visibleWidth(line)).toBeLessThanOrEqual(6);
    expect(
      tool
        .renderResult(
          {
            content: [{ type: "text", text: "Results" }],
            details: { status: "ok" },
          },
          { expanded: false, isPartial: false },
          theme,
          { isError: false },
        )
        .render(80),
    ).toEqual([]);
  }
  const result = await tools[0].execute(
    "id",
    { queries: ["success", "fail"] },
    undefined,
    undefined,
    { cwd: directory },
  );
  expect(result.content[0].text).toContain("Result for success");
  expect(result.details.webProviderResult).toBe(true);
  expect(
    events.tool_result({ details: { status: "partial" } }),
  ).toBeUndefined();
  expect(events.tool_result({ details: result.details })).toEqual({
    isError: true,
  });
  const updates: any[] = [];
  const contents = await tools[1].execute(
    "urls",
    { urls: ["https://ok.test", "https://error.test"] },
    undefined,
    (update: any) => updates.push(update),
    { cwd: directory },
  );
  expect(updates[0].details.inputs[0].state).toBe("queued");
  expect(contents.details.inputs).toEqual([
    { input: "https://ok.test", state: "done" },
    { input: "https://error.test", state: "failed" },
  ]);
  expect(result.details.inputs).toEqual([
    { input: "success", state: "done" },
    { input: "fail", state: "failed" },
  ]);
  for (const index of [0, 2, 3]) {
    const updates: any[] = [];
    const completed = await tools[index].execute(
      `vertical-${index}`,
      index === 3 ? { input: "question" } : { queries: ["question"] },
      undefined,
      (update: any) => updates.push(update),
      { cwd: directory },
    );
    expect(
      updates.some((update) => update.details.inputs[0]?.state === "running"),
    ).toBe(true);
    expect(updates[0].details.inputs).toEqual([
      { input: "question", state: "queued" },
    ]);
    expect(completed.details.inputs).toEqual([
      { input: "question", state: "done" },
    ]);
    expect(
      tools[index]
        .renderResult(
          JSON.parse(JSON.stringify(completed)),
          { expanded: false, isPartial: false },
          theme,
          { isError: false },
        )
        .render(80),
    ).toEqual(["✔︎ question"]);
  }
  const restored = JSON.parse(JSON.stringify(contents));
  expect(
    tools[1]
      .renderResult(restored, { expanded: false, isPartial: false }, theme, {
        isError: true,
      })
      .render(80),
  ).toEqual(["✔︎ https://ok.test", "✘︎ https://error.test"]);
});

it("rejects misplaced provider parameters before execution with a repair hint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webfox-validation-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(
    path,
    stringify({ defaults: { search: { provider: "exa" } } }),
  );
  vi.stubEnv("WEBFOX_CONFIG", path);
  const tools: any[] = [];
  webExtension({
    registerTool: (tool: any) => tools.push(tool),
    on() {},
  } as any);
  const tool = tools.find((tool) => tool.name === "web_search");
  const execute = vi.spyOn(tool, "execute");
  const args = {
    queries: ["private query"],
    options: { highlights: { query: "private value" } },
  };
  const attempt = async () => {
    const prepared = tool.prepareArguments(args);
    return tool.execute("invalid", prepared, undefined, undefined, {
      cwd: directory,
    });
  };
  await expect(attempt()).rejects.toThrow(
    "Invalid parameter: options.highlights. Use options.contents.highlights instead.",
  );
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  ["malformed YAML", "providers: [private-secret", "Invalid YAML"],
  ["invalid schema", "defaults: false", "/defaults: must be object"],
  ["unknown key", "deafaults: {}", "Unknown key: deafaults"],
  [
    "invalid provider options",
    "providers:\n  exa:\n    options:\n      search:\n        type: private-secret\n",
    "/providers/exa/options/search/type",
  ],
  [
    "unsupported default capability",
    "defaults:\n  search:\n    provider: brave\n  research:\n    provider: serper\n",
    "/defaults/research/provider",
  ],
  ["missing explicit file", undefined, "Could not read file"],
])(
  "disables the extension for %s without blocking startup",
  async (_name, config, diagnostic) => {
    const directory = await mkdtemp(join(tmpdir(), "web-pi-invalid-"));
    paths.push(directory);
    const path = join(directory, "config.yaml");
    if (config !== undefined) await writeFile(path, config);
    vi.stubEnv("WEBFOX_CONFIG", path);
    const notify = vi.fn();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const registerTool = vi.fn();
    const events: Record<string, (...args: any[]) => any> = {};
    const pi = {
      registerTool,
      on: (name: string, handler: any) => {
        events[name] = handler;
      },
    } as any;

    expect(() => webExtension(pi)).not.toThrow();
    expect(registerTool).not.toHaveBeenCalled();
    expect(Object.keys(events)).toEqual(["session_start"]);
    expect(stderr).not.toHaveBeenCalled();
    events.session_start({}, { hasUI: true, ui: { notify } });
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Webfox disabled — invalid configuration\n/),
      "error",
    );
    const message = notify.mock.calls[0][0];
    expect(message).toContain(diagnostic);
    expect(message).not.toContain("✘︎");
    expect(message).toContain(`\n  ${path}\n`);
    expect(message.endsWith("\n\nFix the configuration, then /reload.")).toBe(
      true,
    );
    expect(message).not.toMatch(
      /schema is false|additional properties|Provider options belong/,
    );
    expect(message).not.toContain("private-secret");
    expect(stderr).not.toHaveBeenCalled();
    // Print/JSON modes must report on stderr without relying on UI or polluting stdout.
    events.session_start({}, { hasUI: false });
    expect(stderr).toHaveBeenCalledExactlyOnceWith(message);
    expect(stdout).not.toHaveBeenCalled();

    // A fresh extension load after repair must register tools normally.
    await writeFile(path, "defaults:\n  search:\n    provider: brave\n");
    webExtension(pi);
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0][0].name).toBe("web_search");
  },
);

it("exposes every SerpBase mode through web_search and supports a model-visible Maps follow-up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webfox-pi-serpbase-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(
    path,
    stringify({
      defaults: { search: { provider: "serpbase" } },
      providers: { serpbase: { credentials: { api: { value: "test-key" } } } },
    }),
  );
  vi.stubEnv("WEBFOX_CONFIG", path);
  const tools: any[] = [];
  webExtension({
    registerTool: (tool: any) => tools.push(tool),
    on() {},
  } as any);
  expect(tools.map((tool) => tool.name)).toEqual(["web_search"]);
  const tool = tools[0];
  expect(tool.parameters.properties.options.properties.mode.enum).toEqual([
    "search",
    "images",
    "news",
    "videos",
    "maps",
    "maps-detail",
  ]);
  expect(tool.description).toContain("feature_id strings in queries");
  expect(tool.description).toContain(
    "Image results include image and source-page URLs",
  );
  expect(tool.description).not.toContain("web_lookup");
  expect(tool.description).not.toContain("Serper");
  for (const mode of [
    "search",
    "images",
    "news",
    "videos",
    "maps",
    "maps-detail",
  ]) {
    expect(
      Check(tool.parameters, { queries: ["input"], options: { mode } }),
    ).toBe(true);
  }
  expect(
    Check(tool.parameters, {
      queries: ["input"],
      options: { mode: "images", device: "pc" },
    }),
  ).toBe(false);
  const id = "0x123:0x456";
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({
        status: 0,
        places: [{ name: "Cafe", feature_id: id, address: "Main Street" }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 0,
        place: {
          name: "Cafe",
          feature_id: id,
          website: "https://cafe.test",
          phone: "+49 123",
          hours: { Monday: "09:00–17:00" },
        },
      }),
    );
  const maps = await tool.execute(
    "maps",
    { queries: ["cafe"], options: { mode: "maps" } },
    undefined,
    undefined,
    { cwd: directory },
  );
  // Follow the ID from model-visible content, never the UI-only details object.
  const featureId = maps.content[0].text.match(
    /feature_id: (0x[0-9a-f]+:0x[0-9a-f]+)/,
  )?.[1];
  expect(featureId).toBe(id);
  const details = await tool.execute(
    "detail",
    { queries: [featureId], options: { mode: "maps-detail" } },
    undefined,
    undefined,
    { cwd: directory },
  );
  expect(details.content[0].text).toContain("Phone: +49 123");
  expect(details.content[0].text).toContain("Monday");
  expect(details.content[0].text).toContain("https://cafe.test");
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({
    feature_id: id,
    hl: "en",
    gl: "us",
  });
  expect(tools).toHaveLength(1);
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    underline: (text: string) => text,
  };
  expect(
    tool
      .renderResult(details, { expanded: true, isPartial: false }, theme, {
        isError: false,
      })
      .render(160)
      .join("\n"),
  ).toContain(`feature_id: ${id}`);
});

it("keeps unconfigured notifications generic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "web-pi-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(path, "# No providers yet\n");
  vi.stubEnv("WEBFOX_CONFIG", path);
  const notify = vi.fn();
  const registerTool = vi.fn();
  const events: Record<string, (...args: any[]) => any> = {};
  webExtension({
    registerTool,
    on: (name: string, handler: any) => {
      events[name] = handler;
    },
  } as any);
  expect(registerTool).not.toHaveBeenCalled();
  events.session_start({}, { hasUI: false, ui: { notify } });
  expect(notify).not.toHaveBeenCalled();
  events.session_start({}, { hasUI: true, ui: { notify } });
  expect(notify).toHaveBeenCalledWith(
    "Web registered no tools. Select a default provider in the shared configuration, then restart pi.",
    "warning",
  );
  expect(JSON.stringify(notify.mock.calls)).not.toMatch(/fox|mux/i);
});

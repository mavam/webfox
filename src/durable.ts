import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Static } from "typebox";
import {
  defineExtension,
  defineTool,
  type Extension,
} from "@earendil-works/pi-durable";
import { DOCUMENT_SCHEMAS } from "./document-schema.js";
import {
  CAPABILITIES,
  type WebfoxClient,
  type CreateWebfoxOptions,
} from "./index.js";
import {
  WEB_NAMESPACE,
  createClientCache,
  executeCapability,
  formatToolOutput,
  type WebToolParams,
} from "./pi-shared.js";
import { prepareToolArguments } from "./pi-validation.js";
import { descriptions, webToolParameters } from "./tool-definition.js";

export interface DurableWebfoxOptions extends CreateWebfoxOptions {
  /** Supply a client for an embedded host or deterministic tests. */
  client?: WebfoxClient;
}

/** Install alongside CodingTools. Every call uses the conversation's current environment. */
export function createWebfoxExtension(
  options: DurableWebfoxOptions = {},
): Extension {
  const clientFor = createClientCache(options);
  const initialCwd = options.cwd ?? process.cwd();
  const initial = clientFor(initialCwd);
  const inspections = CAPABILITIES.map((capability) =>
    initial.inspectCapability(capability),
  ).filter((inspection) => inspection.provider);
  return defineExtension({
    name: "webfox",
    namespace: { ...WEB_NAMESPACE },
    tools: inspections.map((inspection) => {
      const capability = inspection.capability;
      const parameters = webToolParameters(inspection);
      return defineTool({
        name: `web_${capability}`,
        description: [
          descriptions[capability],
          ...(inspection.promptGuidelines ?? []),
          "Output is limited to 2000 lines or 50 KiB; complete results are saved to a private file when truncated. Codemode scripts receive complete structured results.",
        ].join("\n"),
        parameters,
        structuredOutputSchema: DOCUMENT_SCHEMAS[capability],
        // Web requests may incur charges. A crash reports interruption rather than silently charging again.
        replay: "unsafe",
        prepareArguments: (args) =>
          prepareToolArguments(parameters, args) as Static<typeof parameters>,
        async execute(args, api, context) {
          const client = clientFor(
            api.env?.cwd ?? (await api.agent(context)).cwd ?? initialCwd,
          );
          const result = await executeCapability(
            client,
            capability,
            inspection.provider!,
            args as WebToolParams,
            context.abortSignal,
            (event) => api.output(`${event.message}\n`),
          );
          const { body, json, fullOutputPath } = await formatToolOutput(
            result,
            async (serialized) => {
              if (api.env) {
                const dir = await api.env.createTempDir("web-", context);
                if (!dir.ok) throw dir.error;
                const path = await api.env.joinPath(
                  [dir.value, "result.json"],
                  context,
                );
                if (!path.ok) throw path.error;
                const written = await api.env.writeFile(
                  path.value,
                  serialized,
                  context,
                );
                if (!written.ok) throw written.error;
                return path.value;
              }
              const path = join(
                await mkdtemp(join(tmpdir(), "web-")),
                "result.json",
              );
              await writeFile(path, serialized, { mode: 0o600 });
              return path;
            },
          );
          return {
            output: [{ type: "text", text: body }],
            structuredOutput: JSON.parse(json),
            isError: result.status === "partial",
            details: {
              status: result.status,
              capability,
              ...(fullOutputPath ? { fullOutputPath } : {}),
            },
          };
        },
      });
    }),
  });
}

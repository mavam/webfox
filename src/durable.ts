import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import {
  defineExtension,
  defineTool,
  type Extension,
} from "@earendil-works/pi-durable";
import {
  CAPABILITIES,
  createWebfox,
  type WebfoxClient,
  type CreateWebfoxOptions,
} from "./index.js";
import { prepareToolArguments } from "./pi-validation.js";
import { renderTextDocument } from "./render.js";
import { descriptions, webToolParameters } from "./tool-definition.js";

export interface DurableWebfoxOptions extends CreateWebfoxOptions {
  /** Supply a client for an embedded host or deterministic tests. */
  client?: WebfoxClient;
}

/** Install alongside CodingTools. Every call uses the conversation's current environment. */
export function createWebfoxExtension(
  options: DurableWebfoxOptions = {},
): Extension {
  const clients = new Map<string, WebfoxClient>();
  const clientFor = (cwd: string) => {
    if (options.client) return options.client;
    let client = clients.get(cwd);
    if (!client) {
      client = createWebfox({ ...options, cwd });
      clients.set(cwd, client);
    }
    return client;
  };
  const initialCwd = options.cwd ?? process.cwd();
  const initial = clientFor(initialCwd);
  const inspections = CAPABILITIES.map((capability) =>
    initial.inspectCapability(capability),
  ).filter((inspection) => inspection.provider);
  return defineExtension({
    name: "webfox",
    tools: inspections.map((inspection) => {
      const capability = inspection.capability;
      const parameters = webToolParameters(inspection);
      return defineTool({
        name: `web_${capability}`,
        description: [
          descriptions[capability],
          ...(inspection.promptGuidelines ?? []),
          "Output is limited to 2000 lines or 50 KiB; complete results are saved to a private file when truncated.",
        ].join("\n"),
        parameters,
        // Web requests may incur charges. A crash reports interruption rather than silently charging again.
        replay: "unsafe",
        prepareArguments: (args) =>
          prepareToolArguments(parameters, args) as Static<typeof parameters>,
        async execute(args, api, context) {
          const client = clientFor(
            api.env?.cwd ?? (await api.agent(context)).cwd ?? initialCwd,
          );
          const request = {
            provider: inspection.provider!,
            signal: context.abortSignal,
            options: args.options as Record<string, unknown> | undefined,
            onProgress: (event: { message: string }) =>
              api.output(`${event.message}\n`),
          };
          const result =
            capability === "search"
              ? await client.search({
                  ...request,
                  queries: args.queries as string[],
                  maxResults: args.maxResults as number | undefined,
                })
              : capability === "contents"
                ? await client.contents({
                    ...request,
                    urls: args.urls as string[],
                  })
                : capability === "answer"
                  ? await client.answer({
                      ...request,
                      queries: args.queries as string[],
                    })
                  : await client.research({
                      ...request,
                      input: args.input as string,
                    });
          const truncated = truncateHead(renderTextDocument(result));
          let body = truncated.content;
          let fullOutputPath: string | undefined;
          if (truncated.truncated) {
            fullOutputPath = join(
              await mkdtemp(join(tmpdir(), "web-")),
              "result.json",
            );
            await withFileMutationQueue(fullOutputPath, () =>
              writeFile(fullOutputPath!, JSON.stringify(result), {
                mode: 0o600,
              }),
            );
            body += `\n\nFull results: ${fullOutputPath}`;
          }
          return {
            content: [{ type: "text", text: body }],
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

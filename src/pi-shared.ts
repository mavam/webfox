import {
  createWebfox,
  type Capability,
  type CreateWebfoxOptions,
  type ProgressEvent,
  type ProviderId,
  type WebDocument,
  type WebfoxClient,
} from "./index.js";
import { renderTextDocument } from "./render.js";

export const WEB_NAMESPACE = {
  name: "web",
  description: "Search, extract pages, answer, and research the web.",
} as const;

export const DEFAULT_TOOL_MAX_LINES = 2000;
export const DEFAULT_TOOL_MAX_BYTES = 50 * 1024;

export interface WebToolParams {
  queries?: string[];
  urls?: string[];
  input?: string;
  maxResults?: number;
  options?: Record<string, unknown>;
}

export function createClientCache(
  options: Omit<CreateWebfoxOptions, "cwd"> & { client?: WebfoxClient } = {},
): (cwd: string) => WebfoxClient {
  const clients = new Map<string, WebfoxClient>();
  return (cwd: string) => {
    if (options.client) return options.client;
    let client = clients.get(cwd);
    if (!client) {
      client = createWebfox({ ...options, cwd });
      clients.set(cwd, client);
    }
    return client;
  };
}

export async function executeCapability(
  client: WebfoxClient,
  capability: Capability,
  provider: ProviderId,
  params: WebToolParams,
  signal: AbortSignal | undefined,
  onProgress: ((event: ProgressEvent) => void) | undefined,
): Promise<WebDocument> {
  const request = {
    provider,
    signal,
    options: params.options,
    onProgress,
  };
  switch (capability) {
    case "search":
      return await client.search({
        ...request,
        queries: params.queries!,
        maxResults: params.maxResults,
      });
    case "contents":
      return await client.contents({
        ...request,
        urls: params.urls!,
      });
    case "answer":
      return await client.answer({
        ...request,
        queries: params.queries!,
      });
    case "research":
      return await client.research({
        ...request,
        input: params.input!,
      });
  }
}

/**
 * Head-truncate text to at most `maxLines` lines and `maxBytes` UTF-8 bytes
 * without emitting partial lines (matching Pi's `truncateHead` contract).
 */
export function truncateHeadOutput(
  content: string,
  {
    maxLines = DEFAULT_TOOL_MAX_LINES,
    maxBytes = DEFAULT_TOOL_MAX_BYTES,
  }: { maxLines?: number; maxBytes?: number } = {},
): { content: string; truncated: boolean } {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = splitLinesForCounting(content);
  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false };
  }
  if (lines.length > 0 && Buffer.byteLength(lines[0], "utf-8") > maxBytes) {
    return { content: "", truncated: true };
  }
  const kept: string[] = [];
  let bytes = 0;
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0);
    if (bytes + lineBytes > maxBytes) break;
    kept.push(line);
    bytes += lineBytes;
  }
  return { content: kept.join("\n"), truncated: true };
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

export async function formatToolOutput(
  result: WebDocument,
  writeSpill: (json: string) => Promise<string>,
): Promise<{ body: string; json: string; fullOutputPath?: string }> {
  // The JSON round trip yields the exact document that the CLI prints,
  // free of undefined values and class instances.
  const json = JSON.stringify(result);
  const rendered = renderTextDocument(result);
  const initial = truncateHeadOutput(rendered);
  if (!initial.truncated) {
    return { body: initial.content, json };
  }
  const fullOutputPath = await writeSpill(json);
  const footer = `\n\nFull results: ${fullOutputPath}`;
  // Keep body + footer strictly within the 2000-line / 50 KiB ceiling so
  // host-side output limiters (such as Pi Durable's Harness) never clip the
  // spill-file pointer.
  const footerBytes = Buffer.byteLength(footer, "utf-8");
  const fitted = truncateHeadOutput(rendered, {
    maxLines: Math.max(1, DEFAULT_TOOL_MAX_LINES - 2),
    maxBytes: Math.max(0, DEFAULT_TOOL_MAX_BYTES - footerBytes),
  });
  return {
    body: `${fitted.content}${footer}`,
    json,
    fullOutputPath,
  };
}

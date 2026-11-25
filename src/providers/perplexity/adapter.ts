import { httpError } from "../../errors.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SourceInput,
  ToolOutput,
} from "../contract.js";
import {
  asRecord,
  describeHttpError,
  joinUrl,
  readResponseBody,
  readSseJson,
  requestJson,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

const DEFAULT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_ANSWER_MODEL = "sonar";
const DEFAULT_RESEARCH_MODEL = "sonar-deep-research";

type PerplexitySearchResponse = {
  results?: Array<{
    title?: string;
    url: string;
    snippet?: string;
    date?: string;
    last_updated?: string;
  }>;
};

type PerplexityForegroundChunk = {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  search_results?: Array<{
    title?: string | null;
    url?: string | null;
  }> | null;
  citations?: Array<string | null> | null;
};

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const baseUrl = resolveBaseUrl(config.baseUrl);
    const response = (await requestJson(
      joinUrl(baseUrl, "/search"),
      {
        headers: buildHeaders(config, baseUrl),
        body: {
          ...(request.options ?? {}),
          query: request.query,
          max_results: request.maxResults,
        },
        signal: context.signal,
      },
      (payload, reply) => describeHttpError("Perplexity", payload, reply),
    )) as PerplexitySearchResponse;

    return {
      results: (response.results ?? [])
        .slice(0, request.maxResults)
        .map((result) => ({
          title: result.title,
          url: result.url,
          snippet: trimSnippet(result.snippet),
          metadata:
            result.date || result.last_updated
              ? {
                  ...(result.date ? { date: result.date } : {}),
                  ...(result.last_updated
                    ? { last_updated: result.last_updated }
                    : {}),
                }
              : undefined,
        })),
    };
  },

  async answer(
    request: ProviderRequest<"answer">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return runSilentForegroundChatTool(
      request.query,
      config,
      context,
      DEFAULT_ANSWER_MODEL,
      request.options,
    );
  },

  async research(
    request: ProviderRequest<"research">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return runStreamingForegroundChatTool(
      request.input,
      config,
      context,
      DEFAULT_RESEARCH_MODEL,
      request.options,
    );
  },
};

async function runSilentForegroundChatTool(
  input: string,
  config: HttpProvider,
  context: ProviderContext,
  fallbackModel: string,
  options?: Record<string, unknown>,
): Promise<ToolOutput> {
  const baseUrl = resolveBaseUrl(config.baseUrl);
  const response = (await requestJson(
    joinUrl(baseUrl, "/chat/completions"),
    {
      headers: buildHeaders(config, baseUrl),
      body: {
        ...(options ?? {}),
        messages: [{ role: "user", content: input }],
        model: resolveModel(options?.model, fallbackModel),
        stream: false,
      },
      signal: context.signal,
    },
    (payload, reply) => describeHttpError("Perplexity", payload, reply),
  )) as PerplexityForegroundChunk;

  const content = extractMessageText(response.choices?.[0]?.message?.content);
  const sources = dedupeSources(extractSources(response));

  return {
    text: content,
    sources,
  };
}

async function runStreamingForegroundChatTool(
  input: string,
  config: HttpProvider,
  context: ProviderContext,
  fallbackModel: string,
  options?: Record<string, unknown>,
): Promise<ToolOutput> {
  const baseUrl = resolveBaseUrl(config.baseUrl);
  const response = await fetch(joinUrl(baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...buildHeaders(config, baseUrl),
    },
    body: JSON.stringify({
      ...(options ?? {}),
      messages: [{ role: "user", content: input }],
      model: resolveModel(options?.model, fallbackModel),
      stream: true,
    }),
    signal: context.signal,
  });

  if (!response.ok) {
    const payload = await readResponseBody(response);
    throw httpError(
      response,
      describeHttpError("Perplexity", payload, response),
    );
  }

  let partialText = "";
  let lastChunk: PerplexityForegroundChunk | undefined;
  const sources: SourceInput[] = [];

  const handleChunk = (event: unknown) => {
    const chunk = asRecord(event) as PerplexityForegroundChunk | undefined;
    if (!chunk) return;
    lastChunk = chunk;
    const deltaText = extractDeltaText(chunk.choices?.[0]?.delta?.content);
    if (deltaText) {
      partialText = `${partialText}${deltaText}`;
    }
    sources.push(...extractSources(chunk));
  };

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    handleChunk(await readResponseBody(response));
  } else {
    await readSseJson(response, handleChunk);
  }

  const finalText =
    partialText.trim() ||
    extractMessageText(lastChunk?.choices?.[0]?.message?.content);

  return {
    text: finalText,
    sources: dedupeSources(sources),
  };
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  return (
    baseUrl?.trim() ||
    process.env.PERPLEXITY_BASE_URL?.trim() ||
    DEFAULT_BASE_URL
  );
}

function buildHeaders(
  config: HttpProvider,
  baseUrl: string,
): Record<string, string> {
  const apiKey = requireApiKey(config);
  const custom = parseCustomHeaders(process.env.PERPLEXITY_CUSTOM_HEADERS);
  const hasIntegrationHeader = Object.keys(custom).some(
    (name) => name.toLowerCase() === "x-pplx-integration",
  );
  return {
    ...(shouldSendIntegrationHeader(baseUrl, hasIntegrationHeader)
      ? { "X-Pplx-Integration": "webfox" }
      : {}),
    ...custom,
    Authorization: `Bearer ${apiKey}`,
  };
}

function parseCustomHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon >= 0) {
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name) headers[name] = value;
    }
  }
  return headers;
}

// Identify webfox traffic to the public Perplexity API only, and never
// override a caller-supplied value from PERPLEXITY_CUSTOM_HEADERS.
function shouldSendIntegrationHeader(
  baseUrl: string,
  hasCustomIntegrationHeader: boolean,
): boolean {
  if (hasCustomIntegrationHeader) return false;
  try {
    return new URL(baseUrl).hostname === "api.perplexity.ai";
  } catch {
    return false;
  }
}

function resolveModel(optionModel: unknown, fallbackModel: string): string {
  if (typeof optionModel === "string" && optionModel.trim().length > 0) {
    return optionModel;
  }
  return fallbackModel;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((chunk) => {
      if (
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text" &&
        "text" in chunk &&
        typeof chunk.text === "string"
      ) {
        return [chunk.text.trim()];
      }
      return [];
    })
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}

function extractDeltaText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((chunk) => {
      if (
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text" &&
        "text" in chunk &&
        typeof chunk.text === "string"
      ) {
        return [chunk.text];
      }
      return [];
    })
    .join("");
}

function dedupeSources(sources: SourceInput[]): SourceInput[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.title?.trim().toLowerCase() ?? ""}::${source.url?.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSources(
  response: Pick<PerplexityForegroundChunk, "search_results" | "citations">,
): SourceInput[] {
  const searchResults =
    response.search_results?.flatMap((result) =>
      result.url?.trim()
        ? [{ title: result.title ?? undefined, url: result.url }]
        : [],
    ) ?? [];

  if (searchResults.length > 0) {
    return searchResults;
  }

  return (
    response.citations?.flatMap((citation) => {
      return citation?.trim() ? [{ url: citation }] : [];
    }) ?? []
  );
}

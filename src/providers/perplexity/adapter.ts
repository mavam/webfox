import PerplexityClient from "@perplexity-ai/perplexity_ai";

import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SourceInput,
  ToolOutput,
} from "../contract.js";
import { requireApiKey, trimSnippet } from "../shared.js";

const DEFAULT_ANSWER_MODEL = "sonar";
const DEFAULT_RESEARCH_MODEL = "sonar-deep-research";

type PerplexityForegroundChunk = {
  choices: Array<{
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
    const client = createClient(config);
    const body = {
      ...(request.options ?? {}),
      query: request.query,
      max_results: request.maxResults,
    };

    const response = await client.search.create(
      body as never,
      buildRequestOptions(context),
    );

    return {
      results: response.results.slice(0, request.maxResults).map((result) => ({
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
  const client = createClient(config);

  const request = {
    ...(options ?? {}),
    messages: [{ role: "user", content: input }],
    model: resolveModel(options?.model, fallbackModel),
    stream: false,
  };

  const response = await client.chat.completions.create(
    request as never,
    buildRequestOptions(context),
  );
  const content = extractMessageText(response.choices[0]?.message?.content);
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
  const client = createClient(config);

  const request = {
    ...(options ?? {}),
    messages: [{ role: "user", content: input }],
    model: resolveModel(options?.model, fallbackModel),
    stream: true as const,
  };

  const stream = (await client.chat.completions.create(
    request as never,
    buildRequestOptions(context),
  )) as unknown as AsyncIterable<PerplexityForegroundChunk>;

  let partialText = "";
  let lastChunk: PerplexityForegroundChunk | undefined;
  const sources: SourceInput[] = [];

  for await (const chunk of stream) {
    lastChunk = chunk;
    const deltaText = extractDeltaText(chunk.choices[0]?.delta?.content);
    if (deltaText) {
      partialText = `${partialText}${deltaText}`;
    }
    sources.push(...extractSources(chunk));
  }

  const finalText =
    partialText.trim() ||
    extractMessageText(lastChunk?.choices?.[0]?.message?.content);

  return {
    text: finalText,
    sources: dedupeSources(sources),
  };
}

function createClient(config: HttpProvider): PerplexityClient {
  const apiKey = requireApiKey(config);

  return new PerplexityClient({
    maxRetries: 0,
    apiKey,
    baseURL: config.baseUrl,
    ...(shouldSendIntegrationHeader(config.baseUrl)
      ? { defaultHeaders: { "X-Pplx-Integration": "webfox" } }
      : {}),
  });
}

// Identify webfox traffic to the public Perplexity API only, and never
// override a caller-supplied value from PERPLEXITY_CUSTOM_HEADERS.
function shouldSendIntegrationHeader(baseUrl: string | undefined): boolean {
  const customHeaders = process.env.PERPLEXITY_CUSTOM_HEADERS ?? "";
  if (/^\s*x-pplx-integration\s*:/im.test(customHeaders)) return false;
  const url = baseUrl ?? process.env.PERPLEXITY_BASE_URL?.trim();
  if (!url) return true;
  try {
    return new URL(url).hostname === "api.perplexity.ai";
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

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}

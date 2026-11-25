import {
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
  tavily,
} from "@tavily/core";

import type { ContentsAnswer } from "../../domain.js";
import { WebfoxError } from "../../errors.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
} from "../contract.js";

import {
  ambiguousContentsError,
  omittedContentsError,
  pickSingleUrlOutcome,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    _context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = await client.search(request.query, {
      ...(request.options ?? {}),
      maxResults: request.maxResults,
    });

    return {
      results: response.results.slice(0, request.maxResults).map((result) => ({
        title: result.title,
        url: result.url || "",
        snippet: trimSnippet(result.content ?? result.rawContent),
        score: typeof result.score === "number" ? result.score : undefined,
        metadata: buildSearchMetadata(response, result),
      })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    _context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const client = createClient(config);

    const response = await client.extract([request.url], {
      ...(request.options ?? {}),
    });

    const outcome = pickSingleUrlOutcome(
      request.url,
      response.results,
      response.failedResults,
    );
    if (outcome.kind === "result") {
      const result = outcome.value;
      return {
        url: result.url,
        ...(typeof result.rawContent === "string"
          ? { content: result.rawContent }
          : {}),
        metadata: buildExtractMetadata(response, result),
      };
    }
    if (outcome.kind === "error") {
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        outcome.value.error || "Content extraction failed.",
      );
    }
    if (outcome.kind === "ambiguous") {
      throw ambiguousContentsError();
    }

    throw omittedContentsError();
  },
};

function createClient(config: HttpProvider): TavilyClient {
  return tavily({
    apiKey: requireApiKey(config),
    apiBaseURL: config.baseUrl,
  });
}

function buildSearchMetadata(
  response: TavilySearchResponse,
  result: TavilySearchResponse["results"][number],
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(response.answer ? { answer: response.answer } : {}),
    ...(response.images?.length ? { images: response.images } : {}),
    ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(result.rawContent ? { rawContent: result.rawContent } : {}),
    ...(response.requestId ? { requestId: response.requestId } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    ...(typeof response.responseTime === "number"
      ? { responseTime: response.responseTime }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildExtractMetadata(
  response: TavilyExtractResponse,
  result: TavilyExtractResponse["results"][number],
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(result.title ? { title: result.title } : {}),
    ...(Array.isArray(result.images) ? { images: result.images } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(response.requestId ? { requestId: response.requestId } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    ...(typeof response.responseTime === "number"
      ? { responseTime: response.responseTime }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

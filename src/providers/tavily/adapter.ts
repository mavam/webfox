import {
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
  tavily,
} from "@tavily/core";

import type { ContentsAnswer } from "../../domain.js";
import { WebfoxError } from "../../errors.js";
import type { ProviderContext, SearchResponse } from "../contract.js";
import type { Tavily } from "./types.js";

import {
  ambiguousContentsError,
  omittedContentsError,
  pickSingleUrlOutcome,
  trimSnippet,
} from "../shared.js";

const tavilyImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = await client.search(query, {
      ...(options ?? {}),
      maxResults,
    });

    return {
      provider: "tavily",
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url || "",
        snippet: trimSnippet(result.content ?? result.rawContent),
        score: typeof result.score === "number" ? result.score : undefined,
        metadata: buildSearchMetadata(response, result),
      })),
    };
  },

  async contents(
    url: string,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsAnswer> {
    const client = createClient(config);

    const response = await client.extract([url], {
      ...(options ?? {}),
    });

    const outcome = pickSingleUrlOutcome(
      url,
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

function createClient(config: Tavily): TavilyClient {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return tavily({
    apiKey,
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Tavily,
    context: ProviderContext,
  ) {
    return await tavilyImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Tavily,
    context: ProviderContext,
  ) {
    return await tavilyImplementation.contents(
      input.url,
      config,
      context,
      input.options,
    );
  },
};

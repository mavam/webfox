import ParallelClient from "parallel-web";

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
  formatJson,
  omittedContentsError,
  pickSingleUrlOutcome,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = (await client.search(
      buildParallelSearchParams(request.query, request.maxResults, {
        ...(request.options ?? {}),
      }) as never,
      buildRequestOptions(context),
    )) as ParallelSearchResponse;

    return {
      results: response.results.slice(0, request.maxResults).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: trimSnippet(result.excerpts?.join(" ") ?? ""),
      })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const client = createClient(config);

    const response = (await client.extract(
      buildParallelExtractParams([request.url], {
        ...(request.options ?? {}),
      }) as never,
      buildRequestOptions(context),
    )) as unknown as ParallelExtractResponse;

    const outcome = pickSingleUrlOutcome(
      request.url,
      response.results,
      response.errors,
    );
    if (outcome.kind === "result") {
      const result = outcome.value;
      return {
        url: result.url,
        content:
          result.full_content ?? result.excerpts?.join("\n\n") ?? undefined,
        metadata: result as unknown as Record<string, unknown>,
      };
    }
    if (outcome.kind === "error") {
      throw new WebfoxError("PROVIDER_FAILURE", formatJson(outcome.value));
    }
    if (outcome.kind === "ambiguous") {
      throw ambiguousContentsError();
    }

    throw omittedContentsError();
  },
};

type ParallelSearchMode = NonNullable<
  import("parallel-web/resources/top-level").SearchParams["mode"]
>;

interface ParallelSearchResponse {
  results: Array<{
    title?: string | null;
    url: string;
    excerpts?: string[] | null;
  }>;
}

interface ParallelExtractResponse {
  results: Array<{
    url: string;
    excerpts?: string[] | null;
    full_content?: string | null;
  }>;
  errors: Array<{
    url: string;
  }>;
}

function buildParallelSearchParams(
  query: string,
  maxResults: number,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const {
    advanced_settings: advancedSettingsValue,
    max_results: _legacyMaxResults,
    mode: modeValue,
    objective: objectiveValue,
    search_queries: _searchQueries,
    ...rest
  } = options;
  const advancedSettings = readObjectOption(advancedSettingsValue);
  const mode = normalizeParallelSearchMode(modeValue);
  const objective =
    typeof objectiveValue === "string" && objectiveValue.trim()
      ? objectiveValue.trim()
      : query;

  return {
    ...rest,
    search_queries: [query],
    objective,
    ...(mode ? { mode } : {}),
    advanced_settings: {
      ...advancedSettings,
      max_results: maxResults,
    },
  };
}

function buildParallelExtractParams(
  urls: string[],
  options: Record<string, unknown>,
): Record<string, unknown> {
  const {
    advanced_settings: advancedSettingsValue,
    excerpts: excerptsValue,
    full_content: fullContentValue,
    ...rest
  } = options;
  const advancedSettings = readObjectOption(advancedSettingsValue);

  if (typeof fullContentValue === "boolean") {
    advancedSettings.full_content = fullContentValue;
  }
  if (
    typeof excerptsValue === "boolean" &&
    advancedSettings.excerpt_settings === undefined
  ) {
    advancedSettings.excerpt_settings = excerptsValue
      ? {}
      : { max_chars_per_result: 0 };
  }

  return {
    ...rest,
    urls,
    advanced_settings: advancedSettings,
  };
}

function normalizeParallelSearchMode(
  value: unknown,
): ParallelSearchMode | undefined {
  switch (value) {
    case "advanced":
    case "basic":
    case "fast":
    case "turbo":
      return value;
    default:
      return undefined;
  }
}

function readObjectOption(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function createClient(config: HttpProvider): ParallelClient {
  const apiKey = requireApiKey(config);

  return new ParallelClient({
    maxRetries: 0,
    apiKey,
    baseURL: config.baseUrl,
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}

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
  asRecord,
  describeHttpError,
  joinUrl,
  omittedContentsError,
  pickSingleUrlOutcome,
  readString,
  requestJson,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

const DEFAULT_BASE_URL = "https://api.tavily.com";

interface TavilyImage {
  url: string;
  description?: string;
}

interface TavilySearchResultWire {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  score?: number;
  published_date?: string;
  favicon?: string;
}

interface TavilySearchResponseWire {
  answer?: string;
  response_time?: number;
  request_id?: string;
  usage?: { credits: number };
  images?: Array<string | { url?: string; description?: string }>;
  results?: TavilySearchResultWire[];
}

interface TavilyExtractResultWire {
  url: string;
  title?: string | null;
  raw_content?: string;
  images?: string[];
  favicon?: string;
}

interface TavilyExtractFailedWire {
  url: string;
  error?: string;
}

interface TavilyExtractResponseWire {
  results?: TavilyExtractResultWire[];
  failed_results?: TavilyExtractFailedWire[];
  response_time?: number;
  request_id?: string;
  usage?: { credits: number };
}

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const response = (await tavilyRequest(
      config,
      context,
      "/search",
      serializeSearchBody(request.query, request.maxResults, request.options),
    )) as TavilySearchResponseWire;

    const images = normalizeImages(response.images);
    return {
      results: (response.results ?? [])
        .slice(0, request.maxResults)
        .map((result) => ({
          title: result.title,
          url: result.url || "",
          snippet: trimSnippet(result.content ?? result.raw_content),
          score: typeof result.score === "number" ? result.score : undefined,
          metadata: buildSearchMetadata(response, images, result),
        })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const response = (await tavilyRequest(
      config,
      context,
      "/extract",
      serializeExtractBody(request.url, request.options),
    )) as TavilyExtractResponseWire;

    const outcome = pickSingleUrlOutcome(
      request.url,
      response.results ?? [],
      response.failed_results ?? [],
    );
    if (outcome.kind === "result") {
      const result = outcome.value;
      return {
        url: result.url,
        ...(typeof result.raw_content === "string"
          ? { content: result.raw_content }
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

async function tavilyRequest(
  config: HttpProvider,
  context: ProviderContext,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = requireApiKey(config);
  return await requestJson(
    joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, path),
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: context.signal,
    },
    (payload, response) => describeHttpError("Tavily", payload, response),
  );
}

function toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function serializeSearchBody(
  query: string,
  maxResults: number,
  options?: Record<string, unknown>,
): Record<string, unknown> {
  const { maxHours, ...rest } = options ?? {};
  const body: Record<string, unknown> = { query };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      body[toSnakeCase(key)] = value;
    }
  }
  if (body.max_age_hours === undefined && maxHours !== undefined) {
    body.max_age_hours = maxHours;
  }
  body.max_results = maxResults;
  return body;
}

function serializeExtractBody(
  url: string,
  options?: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { urls: [url] };
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined) {
      body[toSnakeCase(key)] = value;
    }
  }
  return body;
}

function normalizeImages(
  images: TavilySearchResponseWire["images"],
): TavilyImage[] {
  if (!Array.isArray(images)) return [];
  return images.map((image) => {
    if (typeof image === "string") return { url: image };
    const record = asRecord(image);
    const description = readString(record?.description);
    return {
      url: readString(record?.url) ?? "",
      ...(description !== undefined ? { description } : {}),
    };
  });
}

function buildSearchMetadata(
  response: TavilySearchResponseWire,
  images: TavilyImage[],
  result: TavilySearchResultWire,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(response.answer ? { answer: response.answer } : {}),
    ...(images.length ? { images } : {}),
    ...(result.published_date ? { publishedDate: result.published_date } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(result.raw_content ? { rawContent: result.raw_content } : {}),
    ...(response.request_id ? { requestId: response.request_id } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    ...(typeof response.response_time === "number"
      ? { responseTime: response.response_time }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildExtractMetadata(
  response: TavilyExtractResponseWire,
  result: TavilyExtractResultWire,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(result.title ? { title: result.title } : {}),
    ...(Array.isArray(result.images) ? { images: result.images } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(response.request_id ? { requestId: response.request_id } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
    ...(typeof response.response_time === "number"
      ? { responseTime: response.response_time }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

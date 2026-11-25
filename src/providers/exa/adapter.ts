import type { ContentsAnswer } from "../../domain.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  ToolOutput,
} from "../contract.js";

import {
  ambiguousContentsError,
  formatJson,
  joinUrl,
  omittedContentsError,
  pickSingleUrlOutcome,
  requestJson,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

const DEFAULT_BASE_URL = "https://api.exa.ai";
// Exa's API returns no page text unless asked; match its SDK's search default.
const DEFAULT_MAX_CHARACTERS = 10_000;

type ExaResult = Record<string, any>;
type ExaSearchResponse = {
  results?: ExaResult[];
  output?: { content?: unknown };
};
type ExaAnswerResponse = {
  answer?: unknown;
  citations?: ExaResult[];
};

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const response = (await exaRequest(
      config,
      "/search",
      buildSearchBody(request.query, {
        ...(request.options ?? {}),
        numResults: request.maxResults,
      }),
      context,
    )) as ExaSearchResponse;

    return {
      results: (response.results ?? [])
        .slice(0, request.maxResults)
        .map((result) => ({
          title: typeof result.title === "string" ? result.title : undefined,
          url: String(result.url ?? ""),
          snippet: trimSnippet(
            typeof result.text === "string"
              ? result.text
              : Array.isArray(result.highlights)
                ? result.highlights.join(" ")
                : typeof result.summary === "string"
                  ? result.summary
                  : "",
          ),
          score: typeof result.score === "number" ? result.score : undefined,
        })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const response = (await exaRequest(
      config,
      "/contents",
      { urls: [request.url], ...(request.options ?? {}) },
      context,
    )) as ExaSearchResponse;

    const outcome = pickSingleUrlOutcome(request.url, response.results ?? []);
    if (outcome.kind === "omitted") throw omittedContentsError();
    if (outcome.kind === "ambiguous") throw ambiguousContentsError();
    const result = outcome.value;

    return {
      url: typeof result.url === "string" ? result.url : request.url,
      ...(typeof result.text === "string" ? { content: result.text } : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      metadata: result as unknown as Record<string, unknown>,
    };
  },

  async answer(
    request: ProviderRequest<"answer">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    const options = request.options;
    const response = (await exaRequest(
      config,
      "/answer",
      {
        query: request.query,
        stream: false,
        text: options?.text ?? false,
        model: options?.model ?? "exa",
        systemPrompt: options?.systemPrompt,
        outputSchema: options?.outputSchema,
        userLocation: options?.userLocation,
      },
      context,
    )) as ExaAnswerResponse;

    return {
      text:
        typeof response.answer === "string"
          ? response.answer
          : response.answer == null
            ? ""
            : formatJson(response.answer),
      sources: response.citations ?? [],
    };
  },

  async research(
    request: ProviderRequest<"research">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    context.signal?.throwIfAborted();
    context.onProgress?.("Exa is researching and synthesizing the report.");
    const result = (await exaRequest(
      config,
      "/search",
      buildSearchBody(request.input, {
        ...(request.options ?? {}),
        type: "deep-reasoning",
        outputSchema: {
          type: "text",
          description:
            "A detailed Markdown research report answering the query. Cite sources with links, distinguish evidence from uncertainty, and include a conclusion.",
        },
      }),
      context,
    )) as ExaSearchResponse;
    const content = result.output?.content;
    return {
      text: typeof content === "string" ? content : "",
      sources: result.results ?? [],
    };
  },
};

function buildSearchBody(
  query: string,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { stream: _stream, ...rest } = options;
  if (!("contents" in rest)) {
    return {
      query,
      ...rest,
      contents: { text: { maxCharacters: DEFAULT_MAX_CHARACTERS } },
    };
  }
  if (rest.contents === false || rest.contents == null) {
    const { contents: _contents, ...withoutContents } = rest;
    return { query, ...withoutContents };
  }
  return { query, ...rest };
}

async function exaRequest(
  config: HttpProvider,
  path: string,
  body: Record<string, unknown>,
  context: ProviderContext,
): Promise<unknown> {
  const apiKey = requireApiKey(config);

  return await requestJson(
    joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, path),
    { headers: { "x-api-key": apiKey }, body, signal: context.signal },
    readExaError,
  );
}

function readExaError(payload: unknown, response: Response): string {
  if (typeof payload !== "object" || payload === null) {
    const text =
      typeof payload === "string" ? payload.trim().slice(0, 500) : "";
    return text
      ? `Request failed with status ${response.status}: ${text}`
      : `Request failed with status ${response.status}.`;
  }
  const record = payload as Record<string, unknown>;
  const envelope =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : undefined;
  const parts = envelope
    ? [envelope.message ?? record.message]
    : [record.error, record.message];
  const message = parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(". ");
  return message || `Request failed with status ${response.status}.`;
}

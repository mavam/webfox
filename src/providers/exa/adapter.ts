import { orderedContents } from "../../contents.js";

import type { ContentsResponse } from "../../contents.js";
import { WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  SearchResponse,
  ToolOutput,
} from "../contract.js";
import type { Exa } from "./types.js";

import { formatJson, joinUrl, requestJson, trimSnippet } from "../shared.js";

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

const exaImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Exa,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const response = (await exaRequest(
      config,
      "/search",
      buildSearchBody(query, {
        ...(searchOptions ?? {}),
        numResults: maxResults,
      }),
      context,
    )) as ExaSearchResponse;

    return {
      provider: "exa",
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
        title: String(result.title ?? result.url ?? "Untitled"),
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
    urls: string[],
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const response = (await exaRequest(
      config,
      "/contents",
      { urls, ...(options ?? {}) },
      context,
    )) as ExaSearchResponse;

    const results = response.results ?? [];

    return {
      provider: "exa",
      answers: urls.map((url, index) => {
        const result = results[index];
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return {
          url: typeof result.url === "string" ? result.url : url,
          ...(typeof result.text === "string" ? { content: result.text } : {}),
          ...(result.summary !== undefined ? { summary: result.summary } : {}),
          metadata: result as unknown as Record<string, unknown>,
        };
      }),
    };
  },

  async answer(
    query: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const response = (await exaRequest(
      config,
      "/answer",
      {
        query,
        stream: false,
        text: options?.text ?? false,
        model: options?.model ?? "exa",
        systemPrompt: options?.systemPrompt,
        outputSchema: options?.outputSchema,
        userLocation: options?.userLocation,
      },
      context,
    )) as ExaAnswerResponse;

    const lines: string[] = [];
    lines.push(
      typeof response.answer === "string"
        ? response.answer
        : formatJson(response.answer),
    );

    const citations = response.citations ?? [];
    if (citations.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, citation] of citations.entries()) {
        lines.push(
          `${index + 1}. ${String(citation.title ?? citation.url ?? "Untitled")}`,
        );
        lines.push(`   ${String(citation.url ?? "")}`);
      }
    }

    return {
      provider: "exa",
      text: lines.join("\n").trimEnd(),
      itemCount: citations.length,
    };
  },

  async research(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    context.signal?.throwIfAborted();
    context.onProgress?.("Exa is researching and synthesizing the report.");
    const result = (await exaRequest(
      config,
      "/search",
      buildSearchBody(input, {
        ...(options ?? {}),
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
    if (typeof content !== "string" || !content.trim())
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        "Exa returned no research report.",
      );
    const sources = result.results ?? [];
    const lines = [content.trim()];
    if (sources.length) {
      lines.push("", "Sources:");
      for (const [index, source] of sources.entries())
        lines.push(
          `${index + 1}. ${source.title || source.url}`,
          `   ${source.url}`,
        );
    }
    return {
      provider: "exa",
      text: lines.join("\n"),
      itemCount: sources.length,
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
  config: Exa,
  path: string,
  body: Record<string, unknown>,
  context: ProviderContext,
): Promise<unknown> {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Exa,
    context: ProviderContext,
  ) {
    return orderedContents(
      await exaImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};

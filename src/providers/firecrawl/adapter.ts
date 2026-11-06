import { asWebfoxError, WebfoxError } from "../../errors.js";
import { orderedContents } from "../../contents.js";
import type { ContentsResponse } from "../../contents.js";
import type {
  ProviderContext,
  SearchResponse,
  SearchResult,
  ToolOutput,
} from "../contract.js";
import type { Firecrawl } from "./types.js";

import { formatJson, joinUrl, requestJson, trimSnippet } from "../shared.js";

type FirecrawlDocument = {
  markdown?: unknown;
  html?: unknown;
  rawHtml?: unknown;
  json?: unknown;
  metadata?: unknown;
};

type FirecrawlSearchData = Partial<
  Record<"web" | "news" | "images", unknown[]>
>;

const FIRECRAWL_CLOUD_HOST = "api.firecrawl.dev";
const FIRECRAWL_DEFAULT_API_URL = "https://api.firecrawl.dev";
const FIRECRAWL_QUESTION_LIMIT = 10_000;

// Scrape tuning controls shared by `web_contents` (scrape) and `web_answer`.

const firecrawlImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    if (!query.trim()) {
      throw new Error("Query cannot be empty");
    }
    const response = await firecrawlRequest(
      config,
      "/v2/search",
      { ...(options ?? {}), query, limit: maxResults },
      context.signal,
      "Firecrawl search failed.",
    );

    return {
      provider: "firecrawl",
      results: flattenSearchResults(
        (asRecord(response.data) ?? {}) as FirecrawlSearchData,
      ).slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    // `autoResume` is an SDK-side retry loop, not an API field.
    const { autoResume: _autoResume, ...callOptions } = options ?? {};
    const scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: true,

      ...callOptions,
    };

    return {
      provider: "firecrawl",
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const response = await firecrawlRequest(
              config,
              "/v2/scrape",
              { ...scrapeOptions, url: url.trim() },
              context.signal,
              "Firecrawl scrape failed.",
            );
            const document = (asRecord(response.data) ??
              {}) as FirecrawlDocument;
            const content = getDocumentContent(document);
            return {
              url,
              ...(content ? { content } : {}),
              ...(asRecord(document.metadata)
                ? {
                    metadata: document.metadata as Record<string, unknown>,
                  }
                : {}),
            };
          } catch (error) {
            return {
              url,
              error: asWebfoxError(error).toJSON(),
            };
          }
        }),
      ),
    };
  },

  async answer(
    query: string,
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const question = validateQuestion(query);

    const mergedOptions: Record<string, unknown> = {
      onlyMainContent: true,

      ...(options ?? {}),
    };
    const url = validateUrl(mergedOptions.url);
    const scrapeOptions = stripAnswerOnlyOptions(mergedOptions);
    const response = await scrapeQuestion(
      config,
      url,
      question,
      scrapeOptions,
      context.signal,
    );
    const document = getFirecrawlDocument(response);
    return {
      provider: "firecrawl",
      text: readString(document.answer) ?? "",
      sources: [{ url }],
      metadata: {
        url,
        ...(asRecord(document.metadata)
          ? { metadata: document.metadata as Record<string, unknown> }
          : {}),
      },
    };
  },
};

function isFirecrawlCloudApiUrl(apiUrl: string | undefined): boolean {
  return !apiUrl || apiUrl.includes(FIRECRAWL_CLOUD_HOST);
}

function validateQuestion(query: string): string {
  const question = query.trim();
  if (!question) {
    throw new Error("question must be a non-empty string.");
  }
  if (question.length > FIRECRAWL_QUESTION_LIMIT) {
    throw new Error(
      `Firecrawl question must be at most ${FIRECRAWL_QUESTION_LIMIT} characters.`,
    );
  }
  return question;
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Firecrawl answer requires options.url.");
  }
  return value.trim();
}

function stripAnswerOnlyOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { url: _url, formats: _formats, ...scrapeOptions } = options;
  return scrapeOptions;
}

async function scrapeQuestion(
  config: Firecrawl,
  url: string,
  question: string,
  options: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  return await firecrawlRequest(
    config,
    "/v2/scrape",
    {
      ...options,
      url,
      formats: [{ type: "question", question }],
    },
    signal,
    "Firecrawl scrape failed.",
  );
}

/** One Firecrawl API call; the runtime owns retries and cancellation. */
async function firecrawlRequest(
  config: Firecrawl,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  failure: string,
): Promise<Record<string, unknown>> {
  const apiUrl = config.baseUrl ?? FIRECRAWL_DEFAULT_API_URL;
  const apiKey = config.credentials?.api;
  if (isFirecrawlCloudApiUrl(apiUrl) && !apiKey) {
    throw new WebfoxError(
      "PROVIDER_UNAVAILABLE",
      "Firecrawl cloud requires FIRECRAWL_API_KEY; self-hosted instances can use baseUrl without a key.",
    );
  }

  const payload = await requestJson(
    joinUrl(apiUrl, path),
    {
      // Omit Authorization without a key: Firecrawl grants keyless access
      // only when the header is absent.
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body,
      signal,
    },
    (value, response) =>
      readFirecrawlError(value, response.statusText || failure),
  );
  if (isFirecrawlFailure(payload)) {
    throw new Error(readFirecrawlError(payload, failure));
  }
  const record = asRecord(payload);
  if (!record) {
    throw new Error(`Unexpected Firecrawl response: ${formatJson(payload)}`);
  }
  return record;
}

/** Firecrawl wraps every v2 result in `{ success: true, data }`. */
function isFirecrawlFailure(value: unknown): boolean {
  return asRecord(value)?.success !== true;
}

function readFirecrawlError(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return (
    readString(record?.error) ??
    readString(record?.message) ??
    (typeof value === "string" ? value : undefined) ??
    fallback
  );
}

function getFirecrawlDocument(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  if (data) {
    return data;
  }
  if (record) {
    return record;
  }
  throw new Error(`Unexpected Firecrawl response: ${formatJson(value)}`);
}

function flattenSearchResults(response: FirecrawlSearchData): SearchResult[] {
  return (["web", "news", "images"] as const).flatMap((source) =>
    (response[source] ?? [])
      // Firecrawl may return bare URL strings instead of result objects.
      .map((entry) =>
        toSearchResult(
          source,
          typeof entry === "string" ? { url: entry } : entry,
        ),
      )
      .filter((entry): entry is SearchResult => entry !== null),
  );
}

function toSearchResult(
  source: "web" | "news" | "images",
  value: unknown,
): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const metadata = asRecord(entry.metadata);
  const url =
    readString(entry.url) ??
    readString(metadata?.sourceURL) ??
    readString(entry.imageUrl) ??
    "";
  const title = readString(entry.title) ?? readString(metadata?.title);
  const snippet = trimSnippet(
    readString(entry.description) ??
      readString(entry.snippet) ??
      readString(entry.markdown) ??
      readString(metadata?.description) ??
      "",
  );
  const resultMetadata = {
    source,
    ...(readString(entry.category) ? { category: entry.category } : {}),
    ...(readString(entry.date) ? { date: entry.date } : {}),
    ...(readString(entry.imageUrl) ? { imageUrl: entry.imageUrl } : {}),
    ...(typeof entry.position === "number" ? { position: entry.position } : {}),
    ...(metadata ?? {}),
  };

  return {
    title,
    url,
    snippet,
    metadata:
      Object.keys(resultMetadata).length > 1 ? resultMetadata : undefined,
  };
}

function getDocumentContent(document: FirecrawlDocument): string | undefined {
  if (typeof document.markdown === "string" && document.markdown.trim()) {
    return document.markdown;
  }
  if (typeof document.html === "string" && document.html.trim()) {
    return document.html;
  }
  if (typeof document.rawHtml === "string" && document.rawHtml.trim()) {
    return document.rawHtml;
  }
  return document.json !== undefined
    ? JSON.stringify(document.json, null, 2)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return await firecrawlImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return orderedContents(
      await firecrawlImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return await firecrawlImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
};

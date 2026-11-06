import { asWebfoxError, WebfoxError } from "../../errors.js";
import { orderedContents } from "../../contents.js";

import type { ContentsResponse } from "../../contents.js";
import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  SearchResult,
  SourceInput,
  ToolOutput,
} from "../contract.js";
import type { Linkup } from "./types.js";

import {
  formatJson,
  joinUrl,
  expectJsonBody,
  readResponseBody,
  trimSnippet,
} from "../shared.js";

const DEFAULT_BASE_URL = "https://api.linkup.so/v1";

type SearchDepth = "fast" | "standard" | "deep";
type ResearchMode = string;
type ResearchReasoningDepth = string;

type FetchParams = {
  url: string;
  mode?: string;
  includeRawContent?: boolean;
  renderJs?: boolean;
  includeRawHtml?: boolean;
  extractImages?: boolean;
};

type FetchResponse = {
  markdown?: string;
  rawContent?: string;
  rawHtml?: string;
  contentType?: string;
  images?: unknown;
  favicon?: string;
};

type ResearchTask = {
  id: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

type LinkupSearchOptions = {
  depth?: SearchDepth;
  includeImages?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string | number | Date;
  toDate?: string | number | Date;
  query?: string;
  outputType?: string;
  maxResults?: number;
  includeInlineCitations?: boolean;
  includeSources?: boolean;
  structuredOutputSchema?: unknown;
};

type LinkupFetchOptions = Omit<FetchParams, "url"> & {
  url?: string;
};

type ManagedLinkupSearchParams = {
  q: string;
  depth: SearchDepth;
  outputType: "searchResults";
  maxResults: number;
  includeImages?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string;
  toDate?: string;
};

type ManagedLinkupResearchParams = {
  q: string;
  outputType: "sourcedAnswer" | "structured";
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string;
  toDate?: string;
  mode?: ResearchMode;
  reasoningDepth?: ResearchReasoningDepth;
  structuredOutputSchema?: string;
};

type LinkupResearchOptions = {
  outputType?: "sourcedAnswer" | "structured";
  mode?: ResearchMode;
  reasoningDepth?: ResearchReasoningDepth;
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string | number | Date;
  toDate?: string | number | Date;
  structuredOutputSchema?: unknown;
  q?: string;
  query?: string;
  input?: string;
};

const linkupImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const response = (await linkupRequest(config, context, "/search", {
      body: buildSearchParams(query, maxResults, {
        ...(options ?? {}),
      }),
    })) as { results?: unknown[] };

    return {
      provider: "linkup",
      results: (response.results ?? [])
        .map(toSearchResult)
        .filter((result): result is SearchResult => result !== null)
        .slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    return {
      provider: "linkup",
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const response = (await linkupRequest(config, context, "/fetch", {
              body: buildFetchParams(url, {
                ...(options ?? {}),
              }),
            })) as FetchResponse;

            const metadata = Object.fromEntries(
              Object.entries(response).filter(
                ([key, value]) =>
                  [
                    "rawContent",
                    "rawHtml",
                    "contentType",
                    "images",
                    "favicon",
                  ].includes(key) && value !== undefined,
              ),
            );
            return {
              url,
              ...(response.markdown ? { content: response.markdown } : {}),
              ...(Object.keys(metadata).length ? { metadata } : {}),
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

  async research(
    input: string,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: "Linkup",
      providerId: "linkup",
      context,
      start: (researchContext) =>
        linkupImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        linkupImplementation.pollResearch(id, config, researchContext),
    });
  },

  async startResearch(
    input: string,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const task = (await linkupRequest(config, context, "/research", {
      body: buildResearchParams(input, {
        ...(options ?? {}),
      }),
    })) as ResearchTask;

    return { id: task.id };
  },

  async pollResearch(
    id: string,
    config: Linkup,
    context: ProviderContext,
  ): Promise<ResearchPollResult> {
    const task = (await linkupRequest(
      config,
      context,
      `/research/${encodeURIComponent(id)}`,
    )) as ResearchTask;

    if (task.status === "completed") {
      return {
        status: "completed",
        output: formatResearchTaskOutput(task),
      };
    }

    if (task.status === "failed") {
      return {
        status: "failed",
        error: task.error ?? "research failed",
      };
    }

    return {
      status: "in_progress",
      statusText: task.status,
    };
  },
};

function buildSearchParams(
  query: string,
  maxResults: number,
  options: Record<string, unknown>,
): ManagedLinkupSearchParams {
  const searchOptions = options as LinkupSearchOptions;

  if (searchOptions.query !== undefined) {
    throw new Error("Linkup search options cannot override the managed query.");
  }
  if (searchOptions.maxResults !== undefined) {
    throw new Error(
      "Linkup search options cannot override the managed maxResults.",
    );
  }
  if (
    searchOptions.outputType !== undefined &&
    searchOptions.outputType !== "searchResults"
  ) {
    throw new Error("Linkup search only supports outputType 'searchResults'.");
  }
  if (
    searchOptions.includeInlineCitations !== undefined ||
    searchOptions.includeSources !== undefined ||
    searchOptions.structuredOutputSchema !== undefined
  ) {
    throw new Error(
      "Linkup search only supports search-results mode for managed web_search.",
    );
  }

  return {
    q: query,
    depth: searchOptions.depth ?? "standard",
    outputType: "searchResults",
    maxResults,
    ...(searchOptions.includeImages !== undefined
      ? { includeImages: searchOptions.includeImages }
      : {}),
    ...(searchOptions.includeDomains !== undefined
      ? { includeDomains: searchOptions.includeDomains }
      : {}),
    ...(searchOptions.excludeDomains !== undefined
      ? { excludeDomains: searchOptions.excludeDomains }
      : {}),
    ...(searchOptions.fromDate !== undefined
      ? { fromDate: toDate(searchOptions.fromDate, "fromDate") }
      : {}),
    ...(searchOptions.toDate !== undefined
      ? { toDate: toDate(searchOptions.toDate, "toDate") }
      : {}),
  };
}

function buildFetchParams(
  url: string,
  options: Record<string, unknown>,
): FetchParams {
  const fetchOptions = options as LinkupFetchOptions;

  if (fetchOptions.url !== undefined) {
    throw new Error("Linkup fetch options cannot override the managed URL.");
  }

  return {
    url,
    ...(fetchOptions.mode !== undefined ? { mode: fetchOptions.mode } : {}),
    ...(fetchOptions.includeRawContent !== undefined
      ? { includeRawContent: fetchOptions.includeRawContent }
      : {}),
    ...(fetchOptions.renderJs !== undefined
      ? { renderJs: fetchOptions.renderJs }
      : {}),
    ...(fetchOptions.includeRawHtml !== undefined
      ? { includeRawHtml: fetchOptions.includeRawHtml }
      : {}),
    ...(fetchOptions.extractImages !== undefined
      ? { extractImages: fetchOptions.extractImages }
      : {}),
  };
}

function buildResearchParams(
  input: string,
  options: Record<string, unknown>,
): ManagedLinkupResearchParams {
  const researchOptions = options as LinkupResearchOptions;

  if (
    researchOptions.q !== undefined ||
    researchOptions.query !== undefined ||
    researchOptions.input !== undefined
  ) {
    throw new Error(
      "Linkup research options cannot override the managed input.",
    );
  }

  const outputType =
    researchOptions.outputType ??
    (researchOptions.structuredOutputSchema !== undefined
      ? "structured"
      : "sourcedAnswer");

  if (
    outputType === "structured" &&
    researchOptions.structuredOutputSchema === undefined
  ) {
    throw new Error(
      "Linkup research outputType 'structured' requires structuredOutputSchema.",
    );
  }

  if (
    outputType === "sourcedAnswer" &&
    researchOptions.structuredOutputSchema !== undefined
  ) {
    throw new Error(
      "Linkup research structuredOutputSchema requires outputType 'structured'.",
    );
  }

  const commonParams = {
    q: input,
    ...(researchOptions.includeDomains !== undefined
      ? { includeDomains: researchOptions.includeDomains }
      : {}),
    ...(researchOptions.excludeDomains !== undefined
      ? { excludeDomains: researchOptions.excludeDomains }
      : {}),
    ...(researchOptions.fromDate !== undefined
      ? { fromDate: toDate(researchOptions.fromDate, "fromDate") }
      : {}),
    ...(researchOptions.toDate !== undefined
      ? { toDate: toDate(researchOptions.toDate, "toDate") }
      : {}),
    ...(researchOptions.mode !== undefined
      ? { mode: researchOptions.mode }
      : {}),
    ...(researchOptions.reasoningDepth !== undefined
      ? { reasoningDepth: researchOptions.reasoningDepth }
      : {}),
  };

  if (outputType === "structured") {
    return {
      ...commonParams,
      outputType,
      structuredOutputSchema: serializeSchema(
        researchOptions.structuredOutputSchema,
      ),
    };
  }

  return {
    ...commonParams,
    outputType,
  };
}

function serializeSchema(schema: unknown): string {
  return typeof schema === "string" ? schema : JSON.stringify(schema);
}

/** One Linkup API call; the runtime owns retries and cancellation. */
async function linkupRequest(
  config: Linkup,
  context: ProviderContext,
  path: string,
  init: { body?: object } = {},
): Promise<unknown> {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  const response = await fetch(
    joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, path),
    {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: context.signal,
    },
  );
  const payload = await readResponseBody(response);
  if (!response.ok) {
    throw linkupError(response, payload);
  }
  return expectJsonBody(payload, response);
}

// Quota and budget exhaustion use 429 but cannot succeed on retry.
const NON_RETRYABLE_CODES = new Set([
  "INSUFFICIENT_FUNDS_CREDITS",
  "EXCEED_BUDGET_LIMIT",
]);

function linkupError(response: Response, payload: unknown): WebfoxError {
  const error = asRecord(asRecord(payload)?.error);
  const code = readString(error?.code);
  const details = Array.isArray(error?.details) ? error.details : [];
  const message = [
    readString(error?.message) ??
      (typeof payload === "string" && payload.trim()
        ? payload.trim().slice(0, 500)
        : `Linkup request failed with status ${response.status}.`),
    ...details.flatMap((detail) => {
      const text = readString(asRecord(detail)?.message);
      return text ? [text] : [];
    }),
  ].join(" ");
  return new WebfoxError("PROVIDER_FAILURE", message, {
    retryable:
      [408, 429, 500, 502, 503, 504].includes(response.status) &&
      !(code && NON_RETRYABLE_CODES.has(code)),
  });
}

function formatResearchTaskOutput(task: ResearchTask): ToolOutput {
  const output = task.output;
  if (output == null) return { provider: "linkup", text: "" };
  if (typeof output === "string") return { provider: "linkup", text: output };
  const outputType = readString(asRecord(task.input)?.outputType);
  const record = asRecord(output);
  // A sourced answer may lack its text; that is an empty answer, while
  // structured output is the answer itself and is serialized as text.
  if (
    outputType !== "structured" &&
    record &&
    ("answer" in record || "sources" in record)
  )
    return {
      provider: "linkup",
      text: readString(record.answer) ?? "",
      sources: readSources(record.sources),
    };
  return { provider: "linkup", text: formatJson(output) };
}

function toSearchResult(value: unknown): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const url = readString(entry.url) ?? "";
  const title = readString(entry.name);
  const type = readString(entry.type);
  const favicon = readString(entry.favicon);
  const snippet =
    type === "text" ? trimSnippet(readString(entry.content) ?? "") : "";
  const metadata = {
    ...(type ? { type } : {}),
    ...(favicon ? { favicon } : {}),
  };

  return {
    title,
    url,
    snippet,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function readSources(value: unknown): SourceInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) {
      return [];
    }

    const url = readString(source.url);
    if (!url) {
      return [];
    }

    return [
      {
        title: readString(source.name),
        url,
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Linkup filters by calendar day and expects YYYY-MM-DD. */
function toDate(value: string | number | Date, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Linkup option '${name}' must be a valid date string, timestamp, or Date.`,
    );
  }
  return date.toISOString().slice(0, 10);
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return await linkupImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return orderedContents(
      await linkupImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return await linkupImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};

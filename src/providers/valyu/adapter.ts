import type { ContentsAnswer } from "../../domain.js";
import { httpError, WebfoxError } from "../../errors.js";
import { sleep } from "../../runtime/lifecycle.js";
import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  SourceInput,
  ToolOutput,
} from "../contract.js";
import {
  ambiguousContentsError,
  asRecord,
  describeHttpError,
  formatJson,
  joinUrl,
  omittedContentsError,
  pickSingleUrlOutcome,
  readNonEmptyString,
  readResponseBody,
  readSseJson,
  readString,
  requestJson,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

const DEFAULT_BASE_URL = "https://api.valyu.ai/v1";

interface ValyuSearchResultWire {
  title?: string;
  url: string;
  description?: string;
  content?: unknown;
  relevance_score?: number;
}

interface ValyuSearchResponseWire {
  success?: boolean;
  error?: string;
  results?: ValyuSearchResultWire[];
}

interface ValyuContentItemWire {
  url: string;
  status?: string;
  error?: string;
  content?: string | number;
  summary?: unknown;
  [key: string]: unknown;
}

interface ValyuContentsResponseWire {
  success?: boolean;
  error?: string;
  job_id?: string;
  jobId?: string;
  status?: string;
  results?: ValyuContentItemWire[];
}

interface ValyuDeepResearchCreateWire {
  success?: boolean;
  error?: string;
  deepresearch_id?: string;
}

interface ValyuDeepResearchStatusWire {
  success?: boolean;
  error?: string;
  status?: string;
  output?: unknown;
  sources?: SourceInput[];
}

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const response = (await valyuRequest(
      config,
      context,
      "/search",
      buildSearchPayload(request.query, request.maxResults, request.options),
    )) as ValyuSearchResponseWire;

    if (response.success === false) {
      throw new Error(response.error || "search failed");
    }

    return {
      results: (response.results ?? [])
        .slice(0, request.maxResults)
        .map((result) => ({
          title: result.title,
          url: result.url,
          snippet: trimSnippet(
            result.description ??
              (typeof result.content === "string" ? result.content : ""),
          ),
          score: result.relevance_score,
        })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const response = (await valyuRequest(
      config,
      context,
      "/contents",
      buildContentsPayload(request.url, request.options),
    )) as ValyuContentsResponseWire;

    let finalResponse = response;
    const jobId = readNonEmptyString(response.job_id ?? response.jobId);
    if (jobId) {
      while (true) {
        context.signal?.throwIfAborted();
        const status = (await valyuRequest(
          config,
          context,
          `/contents/jobs/${encodeURIComponent(jobId)}`,
        )) as ValyuContentsResponseWire;
        if (
          status.success === false ||
          (status.status !== undefined &&
            ["completed", "partial", "failed"].includes(status.status))
        ) {
          finalResponse = status;
          break;
        }
        await sleep(3000, context.signal);
      }
    }

    if (finalResponse.success === false) {
      throw new Error(finalResponse.error || "contents failed");
    }

    const outcome = pickSingleUrlOutcome(
      request.url,
      finalResponse.results ?? [],
    );
    if (outcome.kind === "omitted") throw omittedContentsError();
    if (outcome.kind === "ambiguous") throw ambiguousContentsError();
    const result = outcome.value;

    if (result.status === "failed" || result.status === "not_found") {
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        result.error ?? formatJson(result),
      );
    }

    return {
      url: result.url,
      ...(typeof result.content === "string" ||
      typeof result.content === "number"
        ? { content: String(result.content) }
        : {}),
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      metadata: result as Record<string, unknown>,
    };
  },

  async answer(
    request: ProviderRequest<"answer">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    const apiKey = requireApiKey(config);
    const response = await fetch(
      joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, "/answer"),
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(
          buildAnswerPayload(request.query, request.options),
        ),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      const payload = await readResponseBody(response);
      throw httpError(response, describeHttpError("Valyu", payload, response));
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = asRecord(await readResponseBody(response));
      if (!data || data.success === false) {
        throw new Error(readString(data?.error) || "answer failed");
      }
      return {
        text: formatAnswerContent(data.contents),
        sources: Array.isArray(data.search_results)
          ? (data.search_results as SourceInput[])
          : [],
      };
    }

    let fullContent = "";
    let searchResults: SourceInput[] = [];
    let finalMetadata: Record<string, unknown> | undefined;

    await readSseJson(response, ({ event, data }) => {
      const parsed = asRecord(data);
      if (!parsed) return;
      if (event === "error" || parsed.success === false) {
        throw new WebfoxError(
          "PROVIDER_FAILURE",
          readNonEmptyString(parsed.error) ??
            readNonEmptyString(parsed.message) ??
            "answer failed",
        );
      }
      if (
        Array.isArray(parsed.search_results) &&
        parsed.success === undefined
      ) {
        searchResults = [
          ...searchResults,
          ...(parsed.search_results as SourceInput[]),
        ];
      } else if (Array.isArray(parsed.choices)) {
        const delta = asRecord(asRecord(parsed.choices[0])?.delta);
        const content = readString(delta?.content);
        if (content) fullContent += content;
      } else if (parsed.success !== undefined) {
        finalMetadata = parsed;
      }
    });

    if (finalMetadata?.success === false) {
      throw new Error(readString(finalMetadata.error) || "answer failed");
    }

    const contents = finalMetadata?.contents ?? fullContent;
    const sources = Array.isArray(finalMetadata?.search_results)
      ? (finalMetadata.search_results as SourceInput[])
      : searchResults;

    return {
      text: formatAnswerContent(contents),
      sources,
    };
  },

  async research(
    request: ProviderRequest<"research">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: "Valyu",
      context,
      start: (researchContext) =>
        startResearch(request.input, config, researchContext, request.options),
      poll: (id, researchContext) => pollResearch(id, config, researchContext),
    });
  },
};

async function startResearch(
  input: string,
  config: HttpProvider,
  context: ProviderContext,
  options?: Record<string, unknown>,
): Promise<ResearchJob> {
  const task = (await valyuRequest(
    config,
    context,
    "/deepresearch/tasks",
    buildDeepResearchPayload(input, options),
  )) as ValyuDeepResearchCreateWire;

  if (task.success === false || !task.deepresearch_id) {
    throw new Error(task.error || "deep research creation failed");
  }

  return { id: task.deepresearch_id };
}

async function pollResearch(
  id: string,
  config: HttpProvider,
  context: ProviderContext,
): Promise<ResearchPollResult> {
  const result = (await valyuRequest(
    config,
    context,
    `/deepresearch/tasks/${encodeURIComponent(id)}/status`,
  )) as ValyuDeepResearchStatusWire;

  if (result.success === false) {
    throw new Error(result.error || "deep research failed");
  }

  if (result.status === "completed") {
    return {
      status: "completed",
      output: {
        text:
          typeof result.output === "string"
            ? result.output
            : result.output
              ? formatJson(result.output)
              : "",
        sources: result.sources ?? [],
      },
    };
  }

  if (result.status === "failed") {
    return {
      status: "failed",
      error: result.error || "research failed",
    };
  }

  if (result.status === "cancelled") {
    return {
      status: "cancelled",
      error: result.error || "research was canceled",
    };
  }

  return { status: "in_progress" };
}

async function valyuRequest(
  config: HttpProvider,
  context: ProviderContext,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = requireApiKey(config);
  return await requestJson(
    joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, path),
    {
      headers: { "x-api-key": apiKey },
      ...(body === undefined ? {} : { body }),
      signal: context.signal,
    },
    (payload, response) => describeHttpError("Valyu", payload, response),
  );
}

function buildSearchPayload(
  query: string,
  maxResults: number,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query,
    search_type:
      typeof options.searchType === "string"
        ? options.searchType.toLowerCase()
        : "all",
    max_num_results: maxResults,
    is_tool_call: options.isToolCall ?? true,
    relevance_threshold: options.relevanceThreshold ?? 0.5,
  };
  const fieldMap: Array<[string, string]> = [
    ["maxPrice", "max_price"],
    ["includedSources", "included_sources"],
    ["excludeSources", "excluded_sources"],
    ["sourceBiases", "source_biases"],
    ["category", "category"],
    ["startDate", "start_date"],
    ["endDate", "end_date"],
    ["historicalCache", "historical_cache"],
    ["countryCode", "country_code"],
    ["responseLength", "response_length"],
    ["fastMode", "fast_mode"],
    ["urlOnly", "url_only"],
    ["instructions", "instructions"],
  ];
  for (const [sourceKey, wireKey] of fieldMap) {
    if (options[sourceKey] !== undefined) {
      payload[wireKey] = options[sourceKey];
    }
  }
  return payload;
}

function buildContentsPayload(
  url: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = { urls: [url] };
  const fieldMap: Array<[string, string]> = [
    ["summary", "summary"],
    ["extractEffort", "extract_effort"],
    ["responseLength", "response_length"],
    ["maxPriceDollars", "max_price_dollars"],
    ["screenshot", "screenshot"],
    ["startDate", "start_date"],
    ["endDate", "end_date"],
    ["historicalCache", "historical_cache"],
  ];
  for (const [sourceKey, wireKey] of fieldMap) {
    if (options[sourceKey] !== undefined) {
      payload[wireKey] = options[sourceKey];
    }
  }
  return payload;
}

function buildAnswerPayload(
  query: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query: query.trim(),
    search_type:
      typeof options.searchType === "string"
        ? options.searchType.toLowerCase()
        : "all",
  };
  const fieldMap: Array<[string, string]> = [
    ["dataMaxPrice", "data_max_price"],
    ["structuredOutput", "structured_output"],
    ["systemInstructions", "system_instructions"],
    ["countryCode", "country_code"],
    ["includedSources", "included_sources"],
    ["excludedSources", "excluded_sources"],
    ["startDate", "start_date"],
    ["endDate", "end_date"],
    ["fastMode", "fast_mode"],
  ];
  for (const [sourceKey, wireKey] of fieldMap) {
    if (options[sourceKey] !== undefined) {
      payload[wireKey] =
        sourceKey === "systemInstructions" &&
        typeof options[sourceKey] === "string"
          ? options[sourceKey].trim()
          : options[sourceKey];
    }
  }
  return payload;
}

function buildDeepResearchPayload(
  input: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const rawMode = readString(options.mode);
  const mode = rawMode === "lite" ? "standard" : (rawMode ?? "fast");
  const payload: Record<string, unknown> = {
    query: input,
    mode,
    output_formats: options.outputFormats ?? ["markdown"],
  };
  if (options.skills !== undefined) payload.skills = options.skills;
  if (options.tools !== undefined) payload.tools = options.tools;
  const searchOption = asRecord(options.search);
  if (searchOption) {
    const search: Record<string, unknown> = {};
    const searchMap: Array<[string, string]> = [
      ["searchType", "search_type"],
      ["includedSources", "included_sources"],
      ["excludedSources", "excluded_sources"],
      ["sourceBiases", "source_biases"],
      ["startDate", "start_date"],
      ["endDate", "end_date"],
      ["historicalCache", "historical_cache"],
      ["category", "category"],
      ["countryCode", "country_code"],
    ];
    for (const [sourceKey, wireKey] of searchMap) {
      if (searchOption[sourceKey] !== undefined) {
        search[wireKey] = searchOption[sourceKey];
      }
    }
    payload.search = search;
  }
  return payload;
}

function formatAnswerContent(contents: unknown): string {
  return typeof contents === "string"
    ? contents
    : contents == null
      ? ""
      : formatJson(contents);
}

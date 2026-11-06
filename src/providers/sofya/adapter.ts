import { orderedContents } from "../../contents.js";
import { asWebfoxError, WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
  ToolOutput,
} from "../contract.js";
import { joinUrl, requestJson, trimSnippet } from "../shared.js";
import type { Sofya } from "./types.js";

const DEFAULT_BASE_URL = "https://sofya.co";
// https://sofya.co/docs: max_results is 1-20.
const MAX_RESULTS = 20;

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: Sofya,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const maxResults = Math.max(
      1,
      Math.min(MAX_RESULTS, Math.trunc(request.maxResults || 0)),
    );
    const payload = await sofyaRequest(config, context, "v1/search", {
      ...asRecord(request.options),
      query: request.query,
      max_results: maxResults,
    });
    const entries = payload.results;
    if (!Array.isArray(entries)) throw invalidResponse("search");

    const results = entries
      .map(toSearchResult)
      .filter((result): result is SearchResult => result !== undefined);
    return { provider: "sofya", results: results.slice(0, maxResults) };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: Sofya,
    context: ProviderContext,
  ) {
    // One URL per call keeps each page's result and error with its input.
    const answers = await Promise.all(
      request.urls.map(async (url) => {
        try {
          const payload = await sofyaRequest(config, context, "v1/fetch", {
            ...asRecord(request.options),
            urls: [url],
          });
          const result = Array.isArray(payload.results)
            ? asRecord(payload.results[0])
            : undefined;
          if (!result) throw invalidResponse("fetch");
          if (result.success === false) {
            return { url, error: text(result.error) ?? "Fetch failed." };
          }
          const {
            url: finalUrl,
            content,
            success: _s,
            error: _e,
            ...rest
          } = result;
          const metadata = Object.fromEntries(
            Object.entries(rest).filter(
              ([, value]) => value !== null && value !== "",
            ),
          );
          return {
            url: text(finalUrl) ?? url,
            content: typeof content === "string" ? content : "",
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          };
        } catch (error) {
          return { url, error: asWebfoxError(error).toJSON() };
        }
      }),
    );
    return orderedContents({ provider: "sofya", answers });
  },

  async answer(
    request: ProviderRequest<"answer">,
    config: Sofya,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    const payload = await sofyaRequest(config, context, "v1/search", {
      ...asRecord(request.options),
      query: request.query,
      include_answer: true,
    });
    const sources = (Array.isArray(payload.results) ? payload.results : [])
      .map(toSearchResult)
      .filter((result): result is SearchResult => result !== undefined);
    return withSources(
      text(payload.answer) ?? "No answer returned.",
      sources,
      queryMetadata(payload),
    );
  },

  async research(
    request: ProviderRequest<"research">,
    config: Sofya,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    context.onProgress?.("Sofya is researching and writing the report.");
    const payload = await sofyaRequest(config, context, "v1/research", {
      ...asRecord(request.options),
      query: request.input,
    });
    const report = text(payload.report);
    if (!report) throw invalidResponse("research");
    const sources = (Array.isArray(payload.sources) ? payload.sources : [])
      .map(asRecord)
      .flatMap((source) => {
        const url = text(source?.url);
        return url ? [{ title: text(source?.title) ?? url, url }] : [];
      });
    return withSources(
      report,
      sources,
      Array.isArray(payload.sub_queries)
        ? { sub_queries: payload.sub_queries }
        : {},
    );
  },
};

async function sofyaRequest(
  config: Sofya,
  context: ProviderContext,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const apiKey = config.credentials?.api;
  if (!apiKey) throw new Error("Sofya is missing an API key");
  const payload = asRecord(
    await requestJson(
      joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, path),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: context.signal,
      },
      describeError,
    ),
  );
  if (!payload) throw invalidResponse(path.replace("v1/", ""));
  return payload;
}

function withSources(
  body: string,
  sources: Array<{ title: string; url: string }>,
  metadata: Record<string, unknown>,
): ToolOutput {
  const lines = [body];
  if (sources.length > 0) {
    lines.push("", "Sources:");
    for (const [index, source] of sources.entries()) {
      lines.push(`${index + 1}. ${source.title}`, `   ${source.url}`);
    }
  }
  return {
    provider: "sofya",
    text: lines.join("\n").trimEnd(),
    itemCount: sources.length,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

// Sofya reports spelling corrections and zero-result retries as the query it ran.
function queryMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    ["altered_query", "relaxed_query"].flatMap((key) => {
      const value = text(payload[key]);
      return value ? [[key, value]] : [];
    }),
  );
}

function invalidResponse(endpoint: string): WebfoxError {
  return new WebfoxError(
    "PROVIDER_FAILURE",
    `Sofya returned an invalid ${endpoint} response.`,
    { retryable: false },
  );
}

function describeError(payload: unknown, response: Response): string {
  const record = asRecord(payload);
  const detail =
    text(record?.detail) ??
    (typeof payload === "string" ? text(payload) : undefined) ??
    (record ? JSON.stringify(record.detail ?? record) : undefined);
  const trimmed = detail?.trim().slice(0, 500);
  return `Sofya request failed (HTTP ${response.status})${trimmed ? `: ${trimmed}` : "."}`;
}

function toSearchResult(entry: unknown): SearchResult | undefined {
  const record = asRecord(entry);
  const url = text(record?.url);
  if (!record || !url) return undefined;
  const { title, url: _url, content, description, fetched, ...rest } = record;
  // With search_depth 'basic', content is page text and description the snippet.
  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(
      ([, value]) =>
        value !== null &&
        !(Array.isArray(value) && value.length === 0) &&
        !(asRecord(value) && Object.keys(value as object).length === 0),
    ),
  );
  if (fetched === true && text(content)) metadata.content = content;
  const excerpt = text(description) ?? text(content);
  return {
    title: text(title) ?? url,
    url,
    snippet: excerpt ? trimSnippet(excerpt) : "",
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

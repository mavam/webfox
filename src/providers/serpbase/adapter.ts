import { httpError, WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../contract.js";
import { trimSnippet } from "../shared.js";
import type { SerpBase } from "./types.js";

const DEFAULT_BASE_URL = "https://api.serpbase.dev";
// Business status codes are independent of the HTTP status, including HTTP 200.
const RETRYABLE_STATUSES = new Set([1029, 1500, 1502, 1503, 1504]);

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: SerpBase,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = config.credentials?.api;
    if (!apiKey) throw new Error("SerpBase search is missing an API key");

    const options = request.options ?? {};
    const response = await fetch(
      `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/google/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          q: request.query,
          ...Object.fromEntries(
            ["hl", "gl", "page", "device"].flatMap((key) =>
              options[key] === undefined ? [] : [[key, options[key]]],
            ),
          ),
        }),
        signal: context.signal,
      },
    );

    // Read once so HTTP errors retain their classification even for non-JSON bodies.
    const body = await response.text();
    let payload: Record<string, unknown> | undefined;
    try {
      payload = asRecord(JSON.parse(body));
    } catch {
      // Handled below, after checking the HTTP and business statuses.
    }
    const status = payload?.status;
    const apiFailure = typeof status === "number" && status !== 0;
    if (!response.ok || apiFailure) {
      const detail = (text(payload?.error) ?? body.trim()).slice(0, 500);
      const message = `SerpBase search request failed (HTTP ${response.status}${apiFailure ? `, status ${status}` : ""})${detail ? `: ${detail}` : "."}`;
      if (apiFailure) {
        throw new WebfoxError("PROVIDER_FAILURE", message, {
          retryable: RETRYABLE_STATUSES.has(status),
        });
      }
      throw httpError(response, message);
    }
    if (
      !payload ||
      status !== 0 ||
      (payload.organic !== undefined && !Array.isArray(payload.organic))
    ) {
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        "SerpBase returned an invalid search response.",
        { retryable: false },
      );
    }

    const { organic, ...searchContext } = payload;
    const results = (Array.isArray(organic) ? organic : [])
      .map((entry) => toSearchResult(entry, searchContext))
      .filter((result): result is SearchResult => result !== undefined);
    return {
      provider: "serpbase",
      // No upstream count parameter or automatic pagination: one requested page.
      results: results.slice(
        0,
        Math.max(1, Math.trunc(request.maxResults || 0)),
      ),
    };
  },
};

function toSearchResult(
  entry: unknown,
  searchContext: Record<string, unknown>,
): SearchResult | undefined {
  const record = asRecord(entry);
  if (!record) return undefined;
  const url = text(record.link) ?? text(record.url);
  if (!url) return undefined;
  const { title, link: _link, url: _url, snippet, ...metadata } = record;
  return {
    title: text(title) ?? url,
    url,
    snippet: trimSnippet(text(snippet)),
    metadata: { ...metadata, searchContext },
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

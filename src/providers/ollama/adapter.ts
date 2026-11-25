import { httpError } from "../../errors.js";
import type { ContentsAnswer } from "../../domain.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
} from "../contract.js";
import { normalizeContentText, requireApiKey, trimSnippet } from "../shared.js";

const DEFAULT_BASE_URL = "https://ollama.com";
const WEB_SEARCH_PATH = "/api/web_search";
const WEB_FETCH_PATH = "/api/web_fetch";

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = requireApiKey(config);

    const response = await fetch(
      resolveEndpoint(config.baseUrl, WEB_SEARCH_PATH),
      {
        method: "POST",
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          query: request.query,
          max_results: clampMaxResults(request.maxResults),
        }),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      throw httpError(response, await buildHttpError(response));
    }

    const data = (await response.json()) as OllamaSearchResponse;
    const results = Array.isArray(data.results) ? data.results : [];

    return {
      results: results
        .slice(0, clampMaxResults(request.maxResults))
        .map((result) => ({
          title: result.title,
          url: result.url ?? "",
          snippet: trimSnippet(result.content),
        })),
    };
  },

  async contents(
    request: ProviderRequest<"contents">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const apiKey = requireApiKey(config);
    const response = await fetch(
      resolveEndpoint(config.baseUrl, WEB_FETCH_PATH),
      {
        method: "POST",
        headers: buildHeaders(apiKey),
        body: JSON.stringify({ url: request.url }),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      throw httpError(response, await buildHttpError(response));
    }

    const data = (await response.json()) as OllamaFetchResponse;
    const content = normalizeContentText(data.content);
    const metadata = buildFetchMetadata(data);
    return {
      url: request.url,
      content,
      ...(metadata ? { metadata } : {}),
    };
  },
};

function buildHeaders(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

function resolveEndpoint(
  baseUrlReference: string | undefined,
  endpointPath: string,
): string {
  const baseUrl = baseUrlReference ?? DEFAULT_BASE_URL;
  const base = baseUrl.replace(/\/+$/, "");
  const apiPath = endpointPath.replace(/^\/api\//, "");

  if (base.endsWith(endpointPath)) {
    return base;
  }
  if (base.endsWith("/api")) {
    return `${base}/${apiPath}`;
  }
  return `${base}${endpointPath}`;
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(10, Math.trunc(value || 0)));
}

async function buildHttpError(response: Response): Promise<string> {
  const detail = await readErrorDetail(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return detail
    ? `Ollama API request failed (${status}): ${detail}`
    : `Ollama API request failed (${status}).`;
}

async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
    };
    for (const key of ["message", "error", "detail"] as const) {
      if (typeof parsed[key] === "string" && parsed[key].trim()) {
        return parsed[key];
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

interface OllamaSearchResponse {
  results?: OllamaSearchResult[];
}

interface OllamaSearchResult {
  title?: string;
  url?: string;
  content?: string;
}

interface OllamaFetchResponse {
  title?: string;
  content?: string;
  links?: string[];
}

function buildFetchMetadata(
  data: OllamaFetchResponse,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (data.title) {
    metadata.title = data.title;
  }
  if (data.links?.length) {
    metadata.links = data.links;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

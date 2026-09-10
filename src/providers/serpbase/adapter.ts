import { httpError, WebfoxError } from "../../errors.js";
import { validateOptions } from "../../configuration/planning.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../contract.js";
import { trimSnippet } from "../shared.js";
import { serpbaseProvider } from "./definition.js";
import { SERPBASE_MODES, type SerpBase, type SerpBaseMode } from "./types.js";

const DEFAULT_BASE_URL = "https://api.serpbase.dev";
// Business status codes are independent of the HTTP status, including HTTP 200.
const RETRYABLE_STATUSES = new Set([1029, 1500, 1502, 1503, 1504]);
const FEATURE_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: SerpBase,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const options: Record<string, unknown> = {
      ...request.options,
      mode: request.options?.mode ?? "search",
    };
    validateOptions(serpbaseProvider, "search", options);
    const mode = options.mode as SerpBaseMode;
    const endpoint = SERPBASE_MODES[mode];
    if (mode === "maps-detail" && !FEATURE_ID.test(request.query)) {
      throw new WebfoxError(
        "INVALID_INPUT",
        "SerpBase maps-detail requires a feature_id (0x...:0x...) in each queries entry. First use mode maps and copy the returned feature_id; names, place_id, CID, and Maps URLs are not accepted.",
      );
    }
    const apiKey = config.credentials?.api;
    if (!apiKey) throw new Error("SerpBase search is missing an API key");

    const response = await fetch(
      `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/google/${endpoint.path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          ...(mode === "maps-detail"
            ? { feature_id: request.query }
            : { q: request.query }),
          ...Object.fromEntries(
            endpoint.options.flatMap((key) =>
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
      const message = `SerpBase ${mode} request failed (HTTP ${response.status}${apiFailure ? `, status ${status}` : ""})${detail ? `: ${detail}` : "."}`;
      if (apiFailure) {
        throw new WebfoxError("PROVIDER_FAILURE", message, {
          retryable: RETRYABLE_STATUSES.has(status),
        });
      }
      throw httpError(response, message);
    }
    const collection = payload?.[endpoint.result];
    if (
      !payload ||
      status !== 0 ||
      (collection !== undefined &&
        (mode === "maps-detail"
          ? !asRecord(collection)
          : !Array.isArray(collection)))
    ) {
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        `SerpBase returned an invalid ${mode} response.`,
        { retryable: false },
      );
    }

    const searchContext = { ...payload };
    // Keep rich SERP modules, but don't repeat result collections on every row.
    for (const { result } of Object.values(SERPBASE_MODES))
      delete searchContext[result];
    const entries =
      mode === "maps-detail"
        ? collection === undefined
          ? []
          : [collection]
        : ((collection as unknown[] | undefined) ?? []);
    const results = entries
      .map((entry) => toSearchResult(entry, searchContext, mode))
      .filter((result): result is SearchResult => result !== undefined);
    return {
      provider: "serpbase",
      // No upstream count parameter or automatic pagination: one page or place.
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
  mode: SerpBaseMode,
): SearchResult | undefined {
  const record = asRecord(entry);
  if (!record || (mode === "images" && isNavigationImage(record)))
    return undefined;
  const isPlace = mode === "maps" || mode === "maps-detail";
  const featureId = text(record.feature_id);
  const url = isPlace
    ? (text(record.google_maps_url) ??
      text(record.url) ??
      text(record.website) ??
      (featureId && FEATURE_ID.test(featureId)
        ? `https://www.google.com/maps?ftid=${encodeURIComponent(featureId)}`
        : undefined))
    : (text(record.link) ??
      text(record.url) ??
      (mode === "images" ? text(record.image_url) : undefined));
  if (!url) return undefined;
  const { title, link: _link, url: _url, snippet, ...metadata } = record;
  return {
    title: text(title) ?? text(record.name) ?? url,
    url,
    snippet: resultSnippet(record, mode),
    metadata: { ...metadata, mode, searchContext },
  };
}

/** Include actionable fields in the existing snippet surface, not UI-only metadata.
 * CLI text, model content, and the plain-text Pi renderer then agree without a new tool. */
function resultSnippet(
  record: Record<string, unknown>,
  mode: SerpBaseMode,
): string {
  const lines: string[] = [];
  const excerpt =
    text(record.snippet) ??
    text(record.short_description) ??
    text(record.description);
  // Some video responses contain empty layout labels rather than an excerpt.
  if (
    excerpt &&
    !(mode === "videos" && /^\s*Duration:\s*Posted:\s*$/i.test(excerpt))
  )
    lines.push(trimSnippet(excerpt));
  const add = (label: string, value: unknown, limit = 600) => {
    if (typeof value === "number" && Number.isFinite(value))
      value = String(value);
    if (text(value))
      lines.push(`${label}: ${trimSnippet(value as string, limit)}`);
  };
  const json = (label: string, value: unknown) => {
    if (value && typeof value === "object")
      add(label, JSON.stringify(value), 1200);
  };
  if (mode === "images") {
    // Keep URLs intact so the model can fetch the actual image or its source page.
    add("Image URL", record.image_url, Infinity);
    add("Source page", text(record.link) ?? text(record.url), Infinity);
    add(
      "Thumbnail",
      text(record.thumbnail_url) ?? text(record.thumbnail),
      Infinity,
    );
    add("Source", text(record.source) ?? text(record.domain));
  } else if (mode === "news" || mode === "videos") {
    add("Source", record.source);
    const published = text(record.published_at) ?? text(record.time);
    // Observed video payloads sometimes put durations in both time aliases.
    // Preserve the value without claiming it is a publication date or duration.
    add(
      published && /^\d{1,3}:\d{2}(?::\d{2})?$/.test(published.trim())
        ? "Time (upstream)"
        : "Published",
      published,
    );
    if (mode === "videos") add("Duration", record.duration);
    add(
      "Thumbnail",
      text(record.thumbnail_url) ?? text(record.thumbnail),
      Infinity,
    );
  } else if (mode === "maps" || mode === "maps-detail") {
    add("feature_id", record.feature_id, Infinity);
    add("Address", record.address);
    add("Rating", record.rating);
    add("Reviews", record.review_count);
    add("Phone", text(record.phone_international) ?? text(record.phone));
    add("Website", record.website, Infinity);
    if (
      typeof record.latitude === "number" &&
      typeof record.longitude === "number"
    )
      add("Coordinates", `${record.latitude}, ${record.longitude}`);
    if (Array.isArray(record.types))
      add(
        "Categories",
        record.types.filter((item) => typeof item === "string").join(", "),
      );
    json("Hours", record.hours);
    json("Open status", record.open_status);
    if (mode === "maps-detail") json("Attributes", record.attributes);
  }
  return lines.join("\n");
}

// Discard only the observed Google navigation-logo artifact, not Google-hosted
// content generally. Filtering happens before the local result limit.
function isNavigationImage(record: Record<string, unknown>): boolean {
  try {
    const image = new URL(String(record.image_url));
    const source = new URL(String(record.link ?? record.url));
    return (
      image.hostname === "www.gstatic.com" &&
      image.pathname === "/m/images/icons/googleg.gif" &&
      (source.hostname === "www.google.com" ||
        source.hostname === "google.com") &&
      (source.pathname === "/" || source.pathname === "/search")
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

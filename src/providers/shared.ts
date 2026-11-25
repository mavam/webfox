import { httpError, WebfoxError } from "../errors.js";
import type { Provider } from "./contract.js";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

export function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
  return strings.length > 0 ? strings : undefined;
}

export function readStringUnion<const TValue extends string>(
  value: unknown,
  values: readonly TValue[],
): TValue | undefined {
  return typeof value === "string" && values.includes(value as TValue)
    ? (value as TValue)
    : undefined;
}

export function requireApiKey(
  config: Provider,
  key = "api",
  label?: string,
): string {
  const value = config.credentials?.[key];
  if (!value) {
    throw new Error(
      label ? `${label} is missing an API key` : "is missing an API key",
    );
  }
  return value;
}

export function omittedContentsError(): WebfoxError {
  return new WebfoxError(
    "PROVIDER_FAILURE",
    "The provider omitted a result for this URL.",
  );
}

export function ambiguousContentsError(): WebfoxError {
  return new WebfoxError(
    "PROVIDER_FAILURE",
    "The provider returned ambiguous results for this URL.",
  );
}

/**
 * Resolve a single requested URL against a batch-shaped extraction response.
 * Prefers an exact result match, then an exact error match, then a sole
 * candidate (for redirects), and rejects ambiguous multi-item payloads.
 */
export function pickSingleUrlOutcome<
  TResult extends { url?: string },
  TError extends { url?: string } = never,
>(
  url: string,
  results: readonly TResult[],
  errors: readonly TError[] = [],
):
  | { kind: "result"; value: TResult }
  | { kind: "error"; value: TError }
  | { kind: "omitted" }
  | { kind: "ambiguous" } {
  const exactResult = results.find((entry) => entry.url === url);
  if (exactResult) return { kind: "result", value: exactResult };
  const exactError = errors.find((entry) => entry.url === url);
  if (exactError) return { kind: "error", value: exactError };
  if (results.length === 1 && errors.length === 0)
    return { kind: "result", value: results[0] };
  if (errors.length === 1 && results.length === 0)
    return { kind: "error", value: errors[0] };
  if (results.length === 0 && errors.length === 0) return { kind: "omitted" };
  return { kind: "ambiguous" };
}

export function trimSnippet(
  input: string | undefined,
  maxLength = 300,
): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
export function normalizeContentText(input: string | undefined): string {
  return (input ?? "")
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
export function asJsonObject(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}

/** Read a response body as JSON, falling back to its text. */
export async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Reject successful responses whose body is empty or not JSON. */
export function expectJsonBody(payload: unknown, response: Response): unknown {
  if (payload === undefined) {
    throw new WebfoxError(
      "PROVIDER_FAILURE",
      `Expected a JSON response but received an empty body (status ${response.status}).`,
    );
  }
  if (typeof payload === "string") {
    const snippet = payload.trim().replace(/\s+/g, " ").slice(0, 200);
    throw new WebfoxError(
      "PROVIDER_FAILURE",
      `Expected a JSON response but received a non-JSON body (status ${response.status}): ${snippet}`,
    );
  }
  return payload;
}

/**
 * Merge header maps with case-insensitive override precedence so later layers
 * replace earlier values without producing comma-joined duplicate headers.
 */
export function mergeHeaders(
  ...layers: Array<Record<string, string> | undefined>
): Record<string, string> {
  const keys = new Map<string, string>();
  const values = new Map<string, string>();
  for (const layer of layers) {
    if (!layer) continue;
    for (const [name, value] of Object.entries(layer)) {
      const lower = name.toLowerCase();
      keys.set(lower, name);
      values.set(lower, value);
    }
  }
  const merged: Record<string, string> = {};
  for (const [lower, name] of keys) {
    merged[name] = values.get(lower)!;
  }
  return merged;
}

export interface SseJsonEvent {
  event?: string;
  data: unknown;
}

/**
 * Read JSON events from a Server-Sent Events response stream.
 * Buffers multi-line `data:` payloads per SSE event, preserves `event:` names,
 * terminates immediately on `[DONE]`, surfaces malformed JSON as a provider
 * error, and lets handler errors propagate.
 */
export async function readSseJson(
  response: Response,
  onEvent: (event: SseJsonEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  let eventName: string | undefined;
  let dataLines: string[] = [];
  let doneStream = false;

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return;
    }
    const raw = dataLines.join("\n").trim();
    const currentEvent = eventName;
    eventName = undefined;
    dataLines = [];
    if (!raw) return;
    if (raw === "[DONE]") {
      doneStream = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      const snippet = raw.replace(/\s+/g, " ").slice(0, 200);
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        `Expected JSON in SSE event data but received: ${snippet}`,
      );
    }
    onEvent({ ...(currentEvent ? { event: currentEvent } : {}), data: parsed });
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventName = value || undefined;
    } else if (field === "data") {
      dataLines.push(value);
    }
  };

  if (!reader) {
    for (const line of (await response.text()).split("\n")) {
      handleLine(line);
      if (doneStream) return;
    }
    dispatch();
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!doneStream) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        handleLine(line);
        if (doneStream) break;
      }
    }
    if (!doneStream) {
      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split("\n")) {
          handleLine(line);
          if (doneStream) break;
        }
      }
      if (!doneStream) dispatch();
    }
  } finally {
    if (doneStream) {
      await reader.cancel().catch(() => {});
    }
  }
}

/** Extract a concise error message from common JSON or plain-text API error bodies. */
export function describeHttpError(
  label: string,
  payload: unknown,
  response: Response,
): string {
  const record = asRecord(payload);
  const errorObj = asRecord(record?.error);
  const detailObj = asRecord(record?.detail);
  const errors = Array.isArray(record?.errors) ? record.errors : [];
  const firstArrayError = errors
    .map((item) => {
      const entry = asRecord(item);
      return (
        readNonEmptyString(entry?.message) ??
        readNonEmptyString(entry?.error) ??
        readNonEmptyString(item)
      );
    })
    .filter((item): item is string => Boolean(item))
    .join("; ");
  const detail =
    readNonEmptyString(errorObj?.message) ??
    readNonEmptyString(detailObj?.error) ??
    readNonEmptyString(detailObj?.message) ??
    readNonEmptyString(record?.error) ??
    readNonEmptyString(record?.message) ??
    readNonEmptyString(record?.detail) ??
    (firstArrayError || undefined) ??
    (typeof payload === "string" ? readNonEmptyString(payload) : undefined);
  const trimmed = detail?.trim().slice(0, 500);
  return trimmed
    ? `${label} request failed (HTTP ${response.status}): ${trimmed}`
    : `${label} request failed (HTTP ${response.status}).`;
}

/**
 * Send one JSON request without retries; the runtime owns retry policy.
 * Non-2xx responses become classified provider errors with the message that
 * `describeError` extracts from the response body.
 */
export async function requestJson(
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
  describeError: (payload: unknown, response: Response) => string,
): Promise<unknown> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const response = await fetch(url, {
    method,
    headers: mergeHeaders(
      {
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      init.headers,
    ),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: init.signal,
  });
  const payload = await readResponseBody(response);
  if (!response.ok) {
    throw httpError(response, describeError(payload, response));
  }
  return expectJsonBody(payload, response);
}

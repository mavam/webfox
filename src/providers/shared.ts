import { httpError } from "../errors.js";

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
    headers: {
      Accept: "application/json",
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: init.signal,
  });
  const payload = await readResponseBody(response);
  if (!response.ok) {
    throw httpError(response, describeError(payload, response));
  }
  return payload;
}

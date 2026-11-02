import { vi } from "vitest";

export type StubRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
};

/**
 * Replace global fetch with a handler. Plain return values become JSON
 * responses; return a Response for non-2xx cases. Returns the recorded calls.
 */
export function stubFetch(
  handler: (request: StubRequest) => unknown | Promise<unknown>,
): StubRequest[] {
  const calls: StubRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request: StubRequest = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(request);
      const result = await handler(request);
      return result instanceof Response ? result : Response.json(result);
    }),
  );
  return calls;
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

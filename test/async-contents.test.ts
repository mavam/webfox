import { afterEach, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { stubFetch } from "./fetch-stub.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("polls async contents without hiding work in an SDK waiter and retains reported URLs", async () => {
  vi.useFakeTimers();
  let polls = 0;
  const calls = stubFetch(({ method }) => {
    if (method === "POST") {
      return { success: true, job_id: "job", status: "pending" };
    }
    polls += 1;
    if (polls === 1) {
      return { success: true, status: "processing" };
    }
    return {
      success: true,
      status: "completed",
      results: [
        { status: "success", url: "https://final.test", content: "page" },
      ],
    };
  });
  const client = createWebfox({
    config: {},
    env: { VALYU_API_KEY: "test-key" },
  });
  const pending = client.contents({
    provider: "valyu",
    urls: ["https://original.test"],
  });
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).results[0]).toMatchObject({
    input: "https://original.test",
    ok: true,
    value: { url: "https://final.test", content: "page" },
  });
  expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
    "POST https://api.valyu.ai/v1/contents",
    "GET https://api.valyu.ai/v1/contents/jobs/job",
    "GET https://api.valyu.ai/v1/contents/jobs/job",
  ]);
});

it("does not create a second contents job when a poll fails, even with retries enabled", async () => {
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return Response.json({
          success: true,
          job_id: "job",
          status: "pending",
        });
      }
      throw Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      });
    }),
  );
  const client = createWebfox({
    config: { execution: { retries: 3, retryDelayMs: 0 } },
    env: { VALYU_API_KEY: "test-key" },
  });
  expect(
    (
      await client.contents({
        provider: "valyu",
        urls: ["https://original.test"],
      })
    ).results[0],
  ).toMatchObject({ ok: false, error: { code: "PROVIDER_FAILURE" } });
  expect(posts).toBe(1);
});

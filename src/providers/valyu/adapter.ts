import { omittedContents, orderedContents } from "../../contents.js";
import { sleep, withSignal } from "../../runtime/lifecycle.js";

import { type ContentResultSuccess, Valyu as ValyuClient } from "valyu-js";
import type { ContentsResponse } from "../../contents.js";
import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
} from "../contract.js";
import type { Valyu } from "./types.js";

import { formatJson, trimSnippet } from "../shared.js";

const valyuImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Valyu,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(searchOptions ?? {}),
      maxNumResults: maxResults,
    };

    const response = await client.search(query, options as never);
    if (!response.success) {
      throw new Error(response.error || "search failed");
    }

    return {
      provider: "valyu",
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
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
    urls: string[],
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const response = await client.contents(urls, {
      ...(options ?? {}),
    } as never);
    let finalResponse;
    if ("jobId" in response) {
      while (true) {
        context.signal?.throwIfAborted();
        const status = await withSignal(
          client.getContentsJob(response.jobId),
          context.signal,
        );
        if (
          !status.success ||
          ["completed", "partial", "failed"].includes(status.status)
        ) {
          finalResponse = status;
          break;
        }
        await sleep(3000, context.signal);
      }
    } else finalResponse = response;

    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "contents failed");
    }

    const resultsByUrl = new Map(
      (finalResponse.results ?? []).map(
        (result) => [result.url, result] as const,
      ),
    );

    return {
      provider: "valyu",
      answers: urls.map((url) => {
        const result =
          resultsByUrl.get(url) ??
          (urls.length === 1 && finalResponse.results?.length === 1
            ? finalResponse.results[0]
            : undefined);
        if (!result) {
          return omittedContents(url);
        }

        if (result.status === "failed" || result.status === "not_found") {
          return {
            url,
            error: result.error ?? formatJson(result),
          };
        }
        // TypeScript cannot narrow a two-valued discriminant across both checks.
        const page = result as ContentResultSuccess;
        return {
          url: page.url,
          ...(typeof page.content === "string" ||
          typeof page.content === "number"
            ? { content: String(page.content) }
            : {}),
          ...(page.summary !== undefined ? { summary: page.summary } : {}),
          metadata: page as unknown as Record<string, unknown>,
        };
      }),
    };
  },

  async answer(
    query: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(query, {
      ...(options ?? {}),
      streaming: false,
    } as never);

    if (!("success" in response) || !response.success) {
      throw new Error(
        "error" in response && typeof response.error === "string"
          ? response.error
          : "answer failed",
      );
    }

    return {
      provider: "valyu",
      text:
        typeof response.contents === "string"
          ? response.contents
          : response.contents == null
            ? ""
            : formatJson(response.contents),
      sources: response.search_results ?? [],
    };
  },

  async research(
    input: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: "Valyu",
      providerId: "valyu",
      context,
      start: (researchContext) =>
        valyuImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        valyuImplementation.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const task = await client.deepresearch.create({
      input,

      ...(options ?? {}),
    } as never);

    if (!task.success || !task.deepresearch_id) {
      throw new Error(task.error || "deep research creation failed");
    }

    return { id: task.deepresearch_id };
  },

  async pollResearch(
    id: string,
    config: Valyu,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const result = await client.deepresearch.status(id);

    if (!result.success) {
      throw new Error(result.error || "deep research failed");
    }

    if (result.status === "completed") {
      return {
        status: "completed",
        output: {
          provider: "valyu",
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
  },
};

function createClient(config: Valyu): ValyuClient {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ValyuClient(apiKey, config.baseUrl);
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Valyu,
    context: ProviderContext,
  ) {
    return await valyuImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Valyu,
    context: ProviderContext,
  ) {
    return orderedContents(
      await valyuImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Valyu,
    context: ProviderContext,
  ) {
    return await valyuImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Valyu,
    context: ProviderContext,
  ) {
    return await valyuImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};

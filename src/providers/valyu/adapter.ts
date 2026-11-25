import { sleep, withSignal } from "../../runtime/lifecycle.js";

import { type ContentResultSuccess, Valyu as ValyuClient } from "valyu-js";
import type { ContentsAnswer } from "../../domain.js";
import { WebfoxError } from "../../errors.js";
import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  HttpProvider,
  ProviderContext,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
} from "../contract.js";

import {
  ambiguousContentsError,
  formatJson,
  omittedContentsError,
  pickSingleUrlOutcome,
  requireApiKey,
  trimSnippet,
} from "../shared.js";

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: HttpProvider,
    _context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(request.options ?? {}),
      maxNumResults: request.maxResults,
    };

    const response = await client.search(request.query, options as never);
    if (!response.success) {
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
    const client = createClient(config);
    const response = await client.contents([request.url], {
      ...(request.options ?? {}),
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
    // TypeScript cannot narrow a two-valued discriminant across both checks.
    const page = result as ContentResultSuccess;
    return {
      url: page.url,
      ...(typeof page.content === "string" || typeof page.content === "number"
        ? { content: String(page.content) }
        : {}),
      ...(page.summary !== undefined ? { summary: page.summary } : {}),
      metadata: page as unknown as Record<string, unknown>,
    };
  },

  async answer(
    request: ProviderRequest<"answer">,
    config: HttpProvider,
    _context: ProviderContext,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(request.query, {
      ...(request.options ?? {}),
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
    request: ProviderRequest<"research">,
    config: HttpProvider,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: "Valyu",
      context,
      start: () => startResearch(request.input, config, request.options),
      poll: (id) => pollResearch(id, config),
    });
  },
};

async function startResearch(
  input: string,
  config: HttpProvider,
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
}

async function pollResearch(
  id: string,
  config: HttpProvider,
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

function createClient(config: HttpProvider): ValyuClient {
  return new ValyuClient(requireApiKey(config), config.baseUrl);
}

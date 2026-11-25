import CloudflareClient from "cloudflare";

import type { ContentsAnswer } from "../../domain.js";
import type { ProviderContext, ProviderRequest } from "../contract.js";
import type { Cloudflare } from "./types.js";

export const adapter = {
  async contents(
    request: ProviderRequest<"contents">,
    config: Cloudflare,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const client = createClient(config);
    const accountId = config.accountId;
    if (!accountId) {
      throw new Error("is missing an account ID");
    }

    const markdown = await client.browserRendering.markdown.create(
      {
        ...(request.options ?? {}),
        account_id: accountId,
        url: request.url,
      } as never,
      buildRequestOptions(context),
    );

    return {
      url: request.url,
      content: markdown,
    };
  },
};

function createClient(config: Cloudflare): CloudflareClient {
  const apiToken = config.credentials?.api;
  if (!apiToken) {
    throw new Error("is missing an API token");
  }

  return new CloudflareClient({
    maxRetries: 0,
    apiToken,
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}

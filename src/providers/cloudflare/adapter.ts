import type { ContentsAnswer } from "../../domain.js";
import { WebfoxError } from "../../errors.js";
import type { ProviderContext, ProviderRequest } from "../contract.js";
import {
  asRecord,
  describeHttpError,
  readNonEmptyString,
  requestJson,
} from "../shared.js";
import type { Cloudflare } from "./types.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export const adapter = {
  async contents(
    request: ProviderRequest<"contents">,
    config: Cloudflare,
    context: ProviderContext,
  ): Promise<ContentsAnswer> {
    const apiToken = config.credentials?.api;
    if (!apiToken) {
      throw new Error("is missing an API token");
    }
    const accountId = config.accountId;
    if (!accountId) {
      throw new Error("is missing an account ID");
    }

    const { cacheTTL, ...body } = request.options ?? {};
    const endpoint = new URL(
      `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}/browser-rendering/markdown`,
    );
    if (cacheTTL !== undefined) {
      endpoint.searchParams.set("cacheTTL", String(cacheTTL));
    }

    const payload = asRecord(
      await requestJson(
        endpoint.toString(),
        {
          headers: { Authorization: `Bearer ${apiToken}` },
          body: { ...body, url: request.url },
          signal: context.signal,
        },
        (data, response) => describeHttpError("Cloudflare", data, response),
      ),
    );

    if (!payload || payload.success === false) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];
      const detail = errors
        .map((entry) => readNonEmptyString(asRecord(entry)?.message))
        .filter((item): item is string => Boolean(item))
        .join("; ");
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        detail || "Cloudflare Browser Rendering request failed.",
      );
    }

    const markdown =
      typeof payload.result === "string" ? payload.result : undefined;
    return {
      url: request.url,
      ...(markdown !== undefined ? { content: markdown } : {}),
    };
  },
};

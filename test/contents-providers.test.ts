import { afterEach, describe, expect, it, vi } from "vitest";
import { providerHarness } from "./provider-harness.js";
import { stubFetch } from "./fetch-stub.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contents providers", () => {
  it("renders contents via Cloudflare Browser Rendering markdown", async () => {
    const { cloudflareProvider } = await import(
      "../src/providers/cloudflare/definition.js"
    );
    const provider = providerHarness(cloudflareProvider);

    const calls = stubFetch(() => ({
      success: true,
      result: "# Cloudflare Docs\n\nRendered content",
    }));

    const result = await provider.contents(
      "https://developers.cloudflare.com/browser-rendering/",
      { credentials: { api: "literal-token" }, accountId: "account-id" },
      { cwd: process.cwd() },
      {
        gotoOptions: {
          waitUntil: "networkidle0",
        },
        cacheTTL: 0,
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.cloudflare.com/client/v4/accounts/account-id/browser-rendering/markdown?cacheTTL=0",
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer literal-token",
        }),
        body: {
          gotoOptions: { waitUntil: "networkidle0" },
          url: "https://developers.cloudflare.com/browser-rendering/",
        },
      }),
    ]);
    expect(result).toMatchObject({
      url: "https://developers.cloudflare.com/browser-rendering/",
      content: "# Cloudflare Docs\n\nRendered content",
    });
  });

  it("keeps full Exa page text instead of collapsing to a snippet", async () => {
    const { exaProvider } = await import("../src/providers/exa/definition.js");
    const provider = providerHarness(exaProvider);
    const longParagraph = "x".repeat(420);

    const calls = stubFetch(() => ({
      results: [
        {
          title: "Example",
          url: "https://example.com",
          text: `Heading\n\n${longParagraph}`,
          summary: "short summary",
        },
      ],
    }));

    const result = await provider.contents(
      "https://example.com",
      {
        credentials: { api: "literal-key" },
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.exa.ai/contents",
        headers: expect.objectContaining({ "x-api-key": "literal-key" }),
        body: { urls: ["https://example.com"] },
      }),
    ]);
    expect(result).toMatchObject({
      url: "https://example.com",
      content: `Heading\n\n${longParagraph}`,
      summary: "short summary",
      metadata: {
        title: "Example",
        url: "https://example.com",
        text: `Heading\n\n${longParagraph}`,
        summary: "short summary",
      },
    });
  });

  it("reports Valyu not_found pages as errors", async () => {
    const { valyuProvider } = await import(
      "../src/providers/valyu/definition.js"
    );
    const provider = providerHarness(valyuProvider);

    stubFetch(() => ({
      success: true,
      results: [
        {
          url: "https://valyu.ai/missing",
          status: "not_found",
          error: "Page not found",
        },
      ],
    }));

    await expect(
      provider.contents(
        "https://valyu.ai/missing",
        { credentials: { api: "literal-key" } },
        { cwd: process.cwd() },
        undefined,
      ),
    ).rejects.toThrow("Page not found");
  });

  it("prefers Valyu content over summaries and preserves line breaks", async () => {
    const { valyuProvider } = await import(
      "../src/providers/valyu/definition.js"
    );
    const provider = providerHarness(valyuProvider);

    const calls = stubFetch(() => ({
      success: true,
      results: [
        {
          url: "https://valyu.ai/docs",
          title: "Valyu Docs",
          summary: "summary only",
          content: "Intro\n\n- Item 1\n- Item 2",
        },
      ],
    }));

    const result = await provider.contents(
      "https://valyu.ai/docs",
      {
        credentials: { api: "literal-key" },
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://api.valyu.ai/v1/contents",
        headers: expect.objectContaining({ "x-api-key": "literal-key" }),
        body: { urls: ["https://valyu.ai/docs"] },
      }),
    ]);
    expect(result).toMatchObject({
      url: "https://valyu.ai/docs",
      content: "Intro\n\n- Item 1\n- Item 2",
      summary: "summary only",
      metadata: {
        url: "https://valyu.ai/docs",
        title: "Valyu Docs",
        summary: "summary only",
        content: "Intro\n\n- Item 1\n- Item 2",
      },
    });
  });
});

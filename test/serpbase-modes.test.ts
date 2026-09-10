import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { renderTextDocument } from "../src/render.js";
import {
  SERPBASE_MODES,
  type SerpBaseMode,
} from "../src/providers/serpbase/types.js";

const featureId = "0x123:0x456";
const place = {
  name: "Example Cafe",
  feature_id: featureId,
  google_maps_url: "https://maps.google.com/example",
  website: "https://cafe.example.com",
  address: "Main Street 1",
  phone: "+49 123",
  rating: 4.5,
  latitude: 52.5,
  longitude: 13.4,
  types: ["Cafe"],
  hours: { Monday: "09:00–17:00" },
  open_status: { text: "Open" },
  attributes: [{ name: "Wi-Fi" }],
};
const fixtures: Record<SerpBaseMode, unknown> = {
  search: {
    status: 0,
    organic: [
      {
        title: "Organic",
        link: "https://organic.test",
        rank: 2,
        snippet: "Summary",
      },
    ],
  },
  images: {
    status: 0,
    images: [
      {
        title: "Image",
        link: "https://source.test",
        image_url: "https://image.test/full.jpg",
        thumbnail_url: "https://image.test/thumb.jpg",
        source: "Image publisher",
      },
    ],
  },
  news: {
    status: 0,
    news: [
      {
        title: "Article",
        link: "https://news.test",
        source: "Publisher",
        time: "2 hours ago",
        snippet: "Article summary",
      },
    ],
  },
  videos: {
    status: 0,
    videos: [
      {
        title: "Tutorial",
        link: "https://video.test",
        source: "Channel",
        duration: "10:30",
        published_at: "Yesterday",
        thumbnail: "https://video.test/thumb.jpg",
      },
    ],
  },
  maps: { status: 0, places: [place] },
  "maps-detail": { status: 0, place },
};
function client(options: Record<string, unknown> = {}) {
  return createWebfox({
    config: {
      defaults: { search: { provider: "serpbase" } },
      providers: { serpbase: { options: { search: options } } },
    },
    env: { SERPBASE_API_KEY: "test-key" },
  });
}
function mock(body: unknown) {
  const fetch = vi.fn().mockImplementation(async () => Response.json(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("SerpBase modes", () => {
  it.each(Object.keys(SERPBASE_MODES) as SerpBaseMode[])(
    "routes %s through the existing search capability with native fields",
    async (mode) => {
      const fetch = mock(fixtures[mode]);
      const result = await client().search({
        queries: [mode === "maps-detail" ? featureId : "query"],
        maxResults: 1,
        options: { mode },
      });
      expect(result.status).toBe("ok");
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe(
        `https://api.serpbase.dev/google/${SERPBASE_MODES[mode].path}`,
      );
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        ...(mode === "maps-detail"
          ? { feature_id: featureId }
          : { q: "query", page: 1 }),
        hl: "en",
        gl: "us",
        ...(mode === "search" ? { device: "default" } : {}),
      });
      expect(result.results[0]).toMatchObject({
        ok: true,
        value: {
          results: [{ metadata: { mode, searchContext: { status: 0 } } }],
        },
      });
      const content = renderTextDocument(result);
      const required: Record<SerpBaseMode, string[]> = {
        search: ["Organic", "https://organic.test", "Summary"],
        images: [
          "https://source.test",
          "Image URL: https://image.test/full.jpg",
          "Thumbnail: https://image.test/thumb.jpg",
          "Image publisher",
        ],
        news: ["Publisher", "2 hours ago", "Article summary"],
        videos: ["Channel", "Duration: 10:30", "Published: Yesterday"],
        maps: [
          "Example Cafe",
          `feature_id: ${featureId}`,
          "Main Street 1",
          "Rating: 4.5",
          "+49 123",
          "https://cafe.example.com",
          "52.5, 13.4",
          "09:00–17:00",
        ],
        "maps-detail": [
          `feature_id: ${featureId}`,
          "Main Street 1",
          "Wi-Fi",
          "Hours:",
          "Open status:",
        ],
      };
      for (const value of required[mode]) expect(content).toContain(value);
      expect(content).not.toContain("[object Object]");
      const row = result.results[0];
      if (!row.ok) throw new Error("Expected success");
      for (const endpoint of Object.values(SERPBASE_MODES))
        expect(row.value.results[0].metadata!.searchContext).not.toHaveProperty(
          endpoint.result,
        );
    },
  );

  it("supports mode-specific configured defaults and preserves compatible defaults on overrides", async () => {
    const fetch = mock(fixtures.news);
    await client({ mode: "news", page: 3, gl: "de" }).search({
      queries: ["news"],
    });
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({
      q: "news",
      page: 3,
      hl: "en",
      gl: "de",
    });
    await client({ device: "pc", page: 2, hl: "de" }).search({
      queries: ["news"],
      options: { mode: "news" },
    });
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({
      q: "news",
      page: 2,
      hl: "de",
      gl: "us",
    });
    await client({ mode: "maps", lat: 52.5, lng: 13.4, zoom: 14 }).search({
      queries: ["news"],
      options: { mode: "news" },
    });
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({
      q: "news",
      page: 1,
      hl: "en",
      gl: "us",
    });
    // Explicit incompatible controls aren't silently ignored.
    await expect(
      client({ device: "pc" }).search({
        queries: ["news"],
        options: { mode: "news", device: "mobile" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("merges coordinate defaults and overrides before enforcing their dependency", async () => {
    const fetch = mock(fixtures.maps);
    await client({ mode: "maps", lat: 0 }).search({
      queries: ["coffee"],
      options: { lng: 0, zoom: 1 },
    });
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toEqual({
      q: "coffee",
      hl: "en",
      gl: "us",
      page: 1,
      lat: 0,
      lng: 0,
      zoom: 1,
    });
    await client({ mode: "maps", lat: 90, lng: -180 }).search({
      queries: ["coffee"],
      options: { zoom: 21 },
    });
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toMatchObject({
      lat: 90,
      lng: -180,
      zoom: 21,
    });
    for (const options of [
      { lat: 0 },
      { lng: 0 },
      { zoom: 14 },
      { lat: 0, zoom: 14 },
    ]) {
      await expect(
        client().search({
          queries: ["coffee"],
          options: { mode: "maps", ...options },
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "coffee",
    "ChIJabc",
    "123456",
    "https://maps.google.com/",
    "0xZZ:0x123",
  ])("rejects invalid maps-detail input %s before transport", async (query) => {
    const fetch = mock(fixtures["maps-detail"]);
    const result = await client().search({
      queries: [query],
      options: { mode: "maps-detail" },
    });
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: expect.stringContaining("feature_id"),
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("looks up each feature ID independently and preserves batch order", async () => {
    const fetch = mock(fixtures["maps-detail"]);
    const ids = ["0x123:0x456", "0xabc:0xDEF"];
    const result = await client().search({
      queries: ids,
      options: { mode: "maps-detail" },
    });
    expect(result.results.map((entry) => entry.input)).toEqual(ids);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual(
      ids.map((feature_id) => ({ feature_id, hl: "en", gl: "us" })),
    );
  });

  it.each(Object.keys(SERPBASE_MODES) as SerpBaseMode[])(
    "rejects malformed %s collections and accepts missing optional collections",
    async (mode) => {
      const query = mode === "maps-detail" ? featureId : "query";
      mock({
        status: 0,
        [SERPBASE_MODES[mode].result]: mode === "maps-detail" ? [] : {},
      });
      const failed = await client().search({
        queries: [query],
        options: { mode },
      });
      expect(failed.results[0]).toMatchObject({
        ok: false,
        error: { code: "PROVIDER_FAILURE", retryable: false },
      });
      mock({ status: 0 });
      const empty = await client().search({
        queries: [query],
        options: { mode },
      });
      expect(empty.results[0]).toMatchObject({
        ok: true,
        value: { results: [] },
      });
    },
  );

  it("filters the observed navigation logo before limiting images without filtering Google content", async () => {
    mock({
      status: 0,
      images: [
        {
          title: "Google",
          link: "https://www.google.com/?tbm=isch",
          image_url: "https://www.gstatic.com/m/images/icons/googleg.gif",
          rank: 1,
        },
        {
          title: "Photo",
          link: "https://photo.test",
          image_url: "https://photo.test/full.jpg",
          rank: 2,
        },
        {
          title: "Logo article",
          link: "https://www.google.com/about/",
          image_url: "https://www.gstatic.com/m/images/icons/googleg.gif",
          rank: 3,
        },
      ],
    });
    const result = await client().search({
      queries: ["photos"],
      maxResults: 2,
      options: { mode: "images" },
    });
    const entry = result.results[0];
    if (!entry.ok) throw new Error("Expected success");
    expect(entry.value.results.map((row) => row.title)).toEqual([
      "Photo",
      "Logo article",
    ]);
    expect(entry.value.results.map((row) => row.metadata?.rank)).toEqual([
      2, 3,
    ]);
  });

  it("does not invent publication dates or durations from malformed upstream video time fields", async () => {
    mock({
      status: 0,
      videos: [
        {
          title: "Video",
          link: "https://video.test",
          snippet: "Duration: Posted:",
          published_at: "7:13",
          time: "7:13",
        },
      ],
    });
    const result = await client().search({
      queries: ["tutorial"],
      options: { mode: "videos" },
    });
    const text = renderTextDocument(result);
    expect(text).toContain("Time (upstream): 7:13");
    expect(text).not.toContain("Published:");
    expect(text).not.toContain("Duration:");
    expect(result.results[0]).toMatchObject({
      ok: true,
      value: {
        results: [{ metadata: { published_at: "7:13", time: "7:13" } }],
      },
    });
  });

  it("retains images without a source URL and places without a Maps URL", async () => {
    mock({ status: 0, images: [{ image_url: "https://image.test/full.jpg" }] });
    const image = await client().search({
      queries: ["image"],
      options: { mode: "images" },
    });
    expect(image.results[0]).toMatchObject({
      ok: true,
      value: { results: [{ url: "https://image.test/full.jpg" }] },
    });
    mock({ status: 0, places: [{ name: "Cafe", feature_id: featureId }] });
    const maps = await client().search({
      queries: ["cafe"],
      options: { mode: "maps" },
    });
    expect(renderTextDocument(maps)).toContain(`feature_id: ${featureId}`);
    expect(maps.results[0]).toMatchObject({
      ok: true,
      value: {
        results: [{ url: "https://www.google.com/maps?ftid=0x123%3A0x456" }],
      },
    });
  });
});

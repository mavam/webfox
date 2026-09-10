import { defineProvider } from "../definition.js";
import { SERPBASE_MODES } from "./types.js";

export const serpbaseProvider = defineProvider({
  id: "serpbase",
  label: "SerpBase",
  docsUrl: "https://serpbase.dev/docs",
  local: false,
  credentials: [{ name: "api", environmentVariable: "SERPBASE_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: { mode: "search", hl: "en", gl: "us", page: 1, device: "default" },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      defaultTimeoutMs: 120_000,
      modeOptionKeys: Object.fromEntries(
        Object.entries(SERPBASE_MODES).map(([mode, definition]) => [
          mode,
          definition.options,
        ]),
      ),
      options: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: Object.keys(SERPBASE_MODES),
            description:
              "Google endpoint: 'search' (default) for organic results, 'images' for visual references, 'news' for journalism, 'videos' for clips/tutorials, 'maps' for businesses/places, or 'maps-detail' for place enrichment. In maps-detail, each queries entry must be a feature_id returned by maps (0x...:0x...), not search text.",
          },
          hl: {
            type: "string",
            minLength: 1,
            description: "Google results language code (for example 'en').",
          },
          gl: {
            type: "string",
            minLength: 1,
            description: "Google results country code (for example 'us').",
          },
          page: {
            type: "integer",
            minimum: 1,
            description:
              "1-based results page (default 1). Not accepted in maps-detail. Only this page is fetched; maxResults limits the returned results, not the upstream page size.",
          },
          device: {
            type: "string",
            enum: ["default", "pc", "mobile"],
            description:
              "Only for search mode: 'default' (default) for automatic routing, 'pc' for desktop, or 'mobile'.",
          },
          lat: {
            type: "number",
            minimum: -90,
            maximum: 90,
            description: "Maps mode only: map center latitude. Requires lng.",
          },
          lng: {
            type: "number",
            minimum: -180,
            maximum: 180,
            description: "Maps mode only: map center longitude. Requires lat.",
          },
          zoom: {
            type: "integer",
            minimum: 1,
            maximum: 21,
            description:
              "Maps mode only: zoom level, 1–21. Requires lat and lng; defaults to 14 when coordinates are supplied.",
          },
        },
        // Flat properties keep CLI flags discoverable. Each branch prohibits
        // fields for other modes; missing discriminators allow partial overrides.
        anyOf: Object.entries(SERPBASE_MODES).map(([mode, definition]) => ({
          properties: {
            mode: { enum: [mode] },
            ...Object.fromEntries(
              ["page", "device", "lat", "lng", "zoom"]
                .filter(
                  (key) =>
                    !(definition.options as readonly string[]).includes(key),
                )
                .map((key) => [key, false]),
            ),
          },
          ...(mode === "maps"
            ? {
                anyOf: [
                  { properties: { lat: false, lng: false, zoom: false } },
                  { required: ["lat", "lng"] },
                ],
              }
            : {}),
        })),
        description:
          "SerpBase Google search modes. In maps-detail, queries contains feature IDs instead of search text. Unknown or mode-incompatible options are rejected. Changing mode drops incompatible inherited defaults, not explicitly supplied options.",
      },
      promptGuidelines: [
        "Use options.mode to choose SerpBase search (organic), images (visual references), news (journalism), videos (clips/tutorials), or maps (businesses/places).",
        "To enrich a place, first use mode maps, then call the same web_search tool with mode maps-detail and the returned feature_id strings in queries. Do not substitute names, place_id, CID, or Maps URLs for feature_id.",
        "Use lat and lng together to center a maps search; zoom requires both. Device selection applies only to organic search, and maps-detail accepts only hl and gl alongside mode.",
        "Each query fetches one page or one place. maxResults only trims locally; request additional pages explicitly. Requests, including retries, may incur charges.",
        "Image results include image and source-page URLs, not image contents. News/video times are upstream text, not verified timestamps. Maps hours and contact fields are shown only when returned.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

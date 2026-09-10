import { defineProvider } from "../definition.js";

export const serpbaseProvider = defineProvider({
  id: "serpbase",
  label: "SerpBase",
  docsUrl: "https://serpbase.dev/docs",
  local: false,
  credentials: [{ name: "api", environmentVariable: "SERPBASE_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: { hl: "en", gl: "us", page: 1, device: "default" },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
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
              "1-based Google results page. Only this page is fetched; maxResults limits the returned results, not the upstream page size.",
          },
          device: {
            enum: ["default", "pc", "mobile"],
            description:
              "Google Search device: 'default' for automatic routing, 'pc' for desktop, or 'mobile'.",
          },
        },
        description: "SerpBase Google organic search options.",
      },
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

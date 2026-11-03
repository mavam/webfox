import { defineProvider } from "../definition.js";

export const keenableProvider = defineProvider({
  id: "keenable",
  label: "Keenable",
  docsUrl: "https://docs.keenable.ai",
  local: false,
  credentials: [{ name: "api", environmentVariable: "KEENABLE_API_KEY" }],
  fields: ["credentials", "baseUrl"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      promptGuidelines: [
        "Keenable returns ranked web results with short descriptions; use web_contents to read selected sources in full.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});

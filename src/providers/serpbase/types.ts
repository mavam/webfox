import type { Provider } from "../contract.js";

export const SERPBASE_MODES = {
  search: {
    path: "search",
    result: "organic",
    options: ["hl", "gl", "page", "device"],
  },
  images: { path: "images", result: "images", options: ["hl", "gl", "page"] },
  news: { path: "news", result: "news", options: ["hl", "gl", "page"] },
  videos: { path: "videos", result: "videos", options: ["hl", "gl", "page"] },
  maps: {
    path: "maps/search",
    result: "places",
    options: ["hl", "gl", "page", "lat", "lng", "zoom"],
  },
  "maps-detail": {
    path: "maps/detail",
    result: "place",
    options: ["hl", "gl"],
  },
} as const;

export type SerpBaseMode = keyof typeof SERPBASE_MODES;

export interface SerpBase extends Provider {
  baseUrl?: string;
}

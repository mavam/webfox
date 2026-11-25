import type { HttpProvider } from "../contract.js";
export interface OpenAIWebSearchToolOptions {
  externalWebAccess?: boolean;
  searchContextSize?: "low" | "medium" | "high";
  allowedDomains?: string[];
  userLocation?: {
    city?: string;
    country?: string;
    region?: string;
    timezone?: string;
  };
}

export interface OpenAISearchOptions extends OpenAIWebSearchToolOptions {
  model?: string;
  instructions?: string;
}

export interface OpenAIAnswerOptions extends OpenAIWebSearchToolOptions {
  model?: string;
  instructions?: string;
}

export interface OpenAIResearchOptions extends OpenAIWebSearchToolOptions {
  model?: string;
  instructions?: string;
  max_tool_calls?: number;
}

export type OpenAI = HttpProvider;

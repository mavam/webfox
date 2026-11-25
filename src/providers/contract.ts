import type {
  Capability as Tool,
  ContentsAnswer,
  ProviderId,
  SearchResult,
} from "../domain.js";
export interface SearchResponse {
  results: SearchResult[];
}

/** A provider citation; the runtime trims fields and drops blank entries. */
export interface SourceInput {
  url?: string;
  title?: string;
}

/**
 * Answer and research output. Return the provider's text as-is, even when
 * empty, and its citations as `sources`; presentation belongs to the renderer.
 */
export interface ToolOutput {
  text: string;
  sources?: SourceInput[];
  metadata?: Record<string, unknown>;
}

export interface ResearchJob {
  id: string;
}

export interface ResearchPollResult {
  status: "in_progress" | "completed" | "failed" | "cancelled";
  statusText?: string;
  output?: ToolOutput;
  error?: string;
}

export interface ProviderContext {
  cwd: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  idempotencyKey?: string;
  retryPolicy?: { retries: number; delayMs: number };
}

export interface SearchRequest {
  capability: "search";
  query: string;
  maxResults: number;
  options?: Record<string, unknown>;
}

export interface ContentsRequest {
  capability: "contents";
  url: string;
  options?: Record<string, unknown>;
}

export interface AnswerRequest {
  capability: "answer";
  query: string;
  options?: Record<string, unknown>;
}

export interface ResearchRequest {
  capability: "research";
  input: string;
  options?: Record<string, unknown>;
}

export interface ProviderRequestMap {
  search: SearchRequest;
  contents: ContentsRequest;
  answer: AnswerRequest;
  research: ResearchRequest;
}

export type ProviderRequest<TTool extends Tool = Tool> =
  ProviderRequestMap[TTool];

export interface ProviderResultMap {
  search: SearchResponse;
  contents: ContentsAnswer;
  answer: ToolOutput;
  research: ToolOutput;
}

export type ProviderResult<TTool extends Tool = Tool> =
  ProviderResultMap[TTool];
export interface Provider {
  credentials?: Record<string, string>;
}

export interface HttpProvider extends Provider {
  baseUrl?: string;
}

export type {
  Capability as Tool,
  ProviderId,
  SearchResult,
} from "../domain.js";

export interface ProviderConfigMap {
  brave: HttpProvider;
  cloudflare: import("./cloudflare/types.js").Cloudflare;
  custom: import("./custom/types.js").Custom;
  exa: HttpProvider;
  firecrawl: HttpProvider;
  gemini: Provider;
  keenable: HttpProvider;
  linkup: HttpProvider;
  ollama: HttpProvider;
  openai: import("./openai/types.js").OpenAI;
  parallel: HttpProvider;
  perplexity: HttpProvider;
  serpbase: import("./serpbase/types.js").SerpBase;
  serper: import("./serper/types.js").Serper;
  sofya: HttpProvider;
  tavily: HttpProvider;
  valyu: HttpProvider;
  youcom: HttpProvider;
}
export type ProviderConfig<T extends ProviderId = ProviderId> =
  ProviderConfigMap[T];

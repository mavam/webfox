import type {
  ContentsAnswer as DocumentContents,
  ProviderId,
  SerializedError,
} from "./domain.js";
import { WebfoxError } from "./errors.js";

/** Internal normalized page, before the adapter associates its request index. */
export interface ContentsAnswer extends DocumentContents {
  error?: string | SerializedError;
  inputIndex?: number;
}
export interface ContentsResponse {
  provider: ProviderId;
  answers: ContentsAnswer[];
}
export interface IndexedContentsResponse {
  provider: ProviderId;
  answers: Array<
    DocumentContents & { inputIndex: number; error?: SerializedError }
  >;
}
/**
 * A batch response that leaves out a requested URL has no result for it. This
 * is a failure, unlike a page that the provider returned without content.
 */
export function omittedContents(url: string): ContentsAnswer {
  return {
    url,
    error: new WebfoxError(
      "PROVIDER_FAILURE",
      "The provider omitted a result for this URL.",
    ).toJSON(),
  };
}
/** Only adapters that themselves assemble pages in request order use this helper. */
export function orderedContents(
  response: ContentsResponse,
): IndexedContentsResponse {
  return {
    provider: response.provider,
    answers: response.answers.map((answer, inputIndex) => ({
      ...answer,
      inputIndex,
      ...(answer.error
        ? {
            error:
              typeof answer.error === "string"
                ? new WebfoxError("PROVIDER_FAILURE", answer.error).toJSON()
                : answer.error,
          }
        : { error: undefined }),
    })),
  };
}

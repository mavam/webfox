import { Type, type Static, type TSchema } from "typebox";
import {
  PROVIDER_IDS,
  WEBFOX_ERROR_CODES,
  type AnswerDocument,
  type Capability,
  type ContentsDocument,
  type ResearchDocument,
  type SearchDocument,
} from "./domain.js";

const closed = { additionalProperties: false } as const;
const metadata = Type.Record(Type.String(), Type.Unknown(), {
  description: "Provider-specific fields.",
});

const searchResult = Type.Object(
  {
    title: Type.String(),
    url: Type.String(),
    snippet: Type.String(),
    score: Type.Optional(Type.Number()),
    metadata: Type.Optional(metadata),
  },
  closed,
);
const contentsAnswer = Type.Object(
  {
    url: Type.String({ description: "Final URL after redirects." }),
    content: Type.Optional(Type.String()),
    summary: Type.Optional(Type.Unknown()),
    metadata: Type.Optional(metadata),
  },
  closed,
);
const textAnswer = Type.Object(
  {
    text: Type.String(),
    itemCount: Type.Optional(Type.Integer()),
    metadata: Type.Optional(metadata),
  },
  closed,
);
const serializedError = Type.Object(
  {
    code: Type.Enum(WEBFOX_ERROR_CODES),
    message: Type.String(),
    retryable: Type.Optional(Type.Boolean()),
  },
  closed,
);

function inputResult<T extends TSchema>(value: T) {
  const input = Type.String({
    description: "The query, URL, or brief this entry answers.",
  });
  return Type.Union([
    Type.Object({ input, ok: Type.Literal(true), value }, closed),
    Type.Object(
      { input, ok: Type.Literal(false), error: serializedError },
      closed,
    ),
  ]);
}

function document<C extends Capability, T extends TSchema>(
  capability: C,
  value: T,
) {
  return Type.Object(
    {
      schemaVersion: Type.Literal(1),
      capability: Type.Literal(capability),
      provider: Type.Enum(PROVIDER_IDS),
      status: Type.Enum(["ok", "partial"], {
        description: "`partial` when at least one input failed.",
      }),
      results: Type.Array(inputResult(value), {
        description: "One entry per input, in input order.",
      }),
    },
    closed,
  );
}

/**
 * JSON Schema of each capability's result document. This is the document the
 * CLI prints with `--format json` and the library returns.
 */
export const DOCUMENT_SCHEMAS = {
  search: document(
    "search",
    Type.Object({ results: Type.Array(searchResult) }, closed),
  ),
  contents: document("contents", contentsAnswer),
  answer: document("answer", textAnswer),
  research: document("research", textAnswer),
} as const;

// Fail type checking when a schema and its domain type drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type DocumentSchemaMatchesDomain = [
  Assert<Same<Static<typeof DOCUMENT_SCHEMAS.search>, SearchDocument>>,
  Assert<Same<Static<typeof DOCUMENT_SCHEMAS.contents>, ContentsDocument>>,
  Assert<Same<Static<typeof DOCUMENT_SCHEMAS.answer>, AnswerDocument>>,
  Assert<Same<Static<typeof DOCUMENT_SCHEMAS.research>, ResearchDocument>>,
];

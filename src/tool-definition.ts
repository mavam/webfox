import { Type, type TObject, type TProperties } from "typebox";
import type { Capability, WebfoxClient } from "./index.js";

export function webToolParameters(
  inspection: ReturnType<WebfoxClient["inspectCapability"]>,
): TObject {
  const capability = inspection.capability;
  const fields: TProperties =
    capability === "contents"
      ? { urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) }
      : capability === "research"
        ? { input: Type.String({ minLength: 1 }) }
        : {
            queries: Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              maxItems: 10,
            }),
            ...(capability === "search"
              ? { maxResults: Type.Optional(Type.Integer({ minimum: 1 })) }
              : {}),
          };
  return Type.Object(
    {
      ...fields,
      ...(inspection.optionSchema
        ? {
            options: Type.Optional(
              inspection.optionSchema as unknown as TObject,
            ),
          }
        : {}),
    },
    { additionalProperties: false },
  );
}

export const descriptions: Record<Capability, string> = {
  search:
    "Search up to ten queries and return titles, URLs, and snippets in input order.",
  contents: "Fetch and extract readable contents from web URLs.",
  answer: "Answer up to ten questions using web-grounded evidence.",
  research:
    "Run foreground multi-step web research and return the final report.",
};

import { asWebfoxError, WebfoxError } from "../errors.js";
import type {
  Capability,
  CapabilityDocument,
  InputResult,
  ProgressEvent,
  SerializedError,
} from "../domain.js";

/** The only boundary through which internal provider data reaches a caller. */
export class OutwardBoundary {
  private readonly secrets = new Set<string>();
  addSecret(secret: string): void {
    if (secret) this.secrets.add(secret);
  }
  text(value: string): string {
    return [...this.secrets]
      .sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.split(secret).join("[redacted]"), value);
  }
  value<T>(value: T): T {
    const seen = new WeakSet<object>();
    const visit = (entry: unknown): unknown => {
      if (typeof entry === "string") return this.text(entry);
      if (!entry || typeof entry !== "object") return entry;
      if (seen.has(entry)) return "[Circular]";
      seen.add(entry);
      const result = Array.isArray(entry)
        ? entry.map(visit)
        : Object.fromEntries(
            Object.entries(entry).map(([key, child]) => [
              this.text(key),
              /authorization|api[-_]?key|token|credential|password|secret|headers?/i.test(
                key,
              )
                ? "[redacted]"
                : visit(child),
            ]),
          );
      seen.delete(entry);
      return result;
    };
    return visit(value) as T;
  }
  /** Redact a document without ever renaming fixed response-envelope keys. */
  document<T, C extends Capability>(
    doc: CapabilityDocument<T, C>,
  ): CapabilityDocument<T, C> {
    return {
      schemaVersion: doc.schemaVersion,
      capability: doc.capability,
      provider: doc.provider,
      status: doc.status,
      results: doc.results.map(
        (entry): InputResult<T> =>
          entry.ok
            ? {
                input: this.text(entry.input),
                ok: true,
                value: this.redactResultValue(entry.value),
              }
            : {
                input: this.text(entry.input),
                ok: false,
                error: this.redactSerializedError(entry.error),
              },
      ),
    };
  }
  progress(event: ProgressEvent): ProgressEvent {
    return {
      capability: event.capability,
      provider: event.provider,
      message: this.text(event.message),
      ...(event.inputIndex === undefined
        ? {}
        : { inputIndex: event.inputIndex }),
      ...(event.input === undefined ? {} : { input: this.text(event.input) }),
      ...(event.state === undefined ? {} : { state: event.state }),
    };
  }
  error(error: unknown): SerializedError {
    return this.redactSerializedError(asWebfoxError(error).toJSON());
  }
  exception(error: unknown): WebfoxError {
    const safe = this.error(error);
    // Do not expose an unredacted cause through the public exception.
    return new WebfoxError(safe.code, safe.message, {
      retryable: safe.retryable,
    });
  }
  private redactSerializedError(error: SerializedError): SerializedError {
    return {
      code: error.code,
      message: this.text(error.message),
      ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
    };
  }
  private redactResultValue<T>(value: T): T {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return this.value(value);
    // Preserve top-level canonical payload field names (results, url, content,
    // text, sources, itemCount, metadata, ...) while redacting their values.
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [
        key,
        key === "results" && Array.isArray(child)
          ? child.map((item) => this.redactResultValue(item))
          : key === "sources" && Array.isArray(child)
            ? child.map((item) => this.redactResultValue(item))
            : this.value(child),
      ]),
    ) as T;
  }
}

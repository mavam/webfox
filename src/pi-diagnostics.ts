import { homedir } from "node:os";
import { sep } from "node:path";
import { resolveConfigPath } from "./configuration/file.js";
import type { WebfoxError } from "./errors.js";

export function configurationDiagnostic(error: WebfoxError): string {
  const diagnostic = error.options.configuration;
  const source = diagnostic?.source ?? resolveConfigPath();
  const home = homedir() + sep;
  const path = source.startsWith(home)
    ? `~/${source.slice(home.length)}`
    : source;
  const issues = diagnostic?.issues ?? [error.message];
  return [
    "Webfox disabled — invalid configuration",
    `  ${path}`,
    ...issues.map((issue) => `  ${issue}`),
    "",
    "Fix the configuration, then /reload.",
  ].join("\n");
}

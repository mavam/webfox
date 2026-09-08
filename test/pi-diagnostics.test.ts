import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseConfig } from "../src/configuration/file.js";
import { WebfoxError } from "../src/errors.js";
import { configurationDiagnostic } from "../src/pi-diagnostics.js";

it("renders a compact diagnostic for an unknown key without duplicate schema errors", () => {
  let error: unknown;
  try {
    parseConfig("deafaults: {}", join(homedir(), ".config/webfox/config.yaml"));
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(WebfoxError);
  expect(configurationDiagnostic(error as WebfoxError)).toBe(
    "Webfox disabled — invalid configuration\n" +
      "  ~/.config/webfox/config.yaml\n" +
      "  Unknown key: deafaults\n\n" +
      "Fix the configuration, then /reload.",
  );
});

it("reports nested unknown keys without showing their values", () => {
  let error: unknown;
  try {
    parseConfig(
      "defaults:\n  search:\n    typo: private-secret",
      "/tmp/config.yaml",
    );
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(WebfoxError);
  const message = configurationDiagnostic(error as WebfoxError);
  expect(message).toContain("Unknown key: defaults.search.typo");
  expect(message).not.toContain("private-secret");
});

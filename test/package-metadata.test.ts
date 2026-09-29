import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  CONFIG_SCHEMA_URL,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "../src/package-metadata.js";

describe("package metadata", () => {
  it("keeps Pi runtime packages optional for standalone consumers", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    for (const peer of [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ]) {
      expect(packageJson.peerDependencies[peer]).toBe("*");
      expect(packageJson.peerDependenciesMeta[peer]).toEqual({
        optional: true,
      });
      expect(packageJson.dependencies).not.toHaveProperty(peer);
      expect(packageJson.optionalDependencies ?? {}).not.toHaveProperty(peer);
      expect(packageJson.bundledDependencies ?? []).not.toContain(peer);
    }
  });
  it("never lists host-provided Pi packages as dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    // Pi maps these modules into extensions. A physical copy would bypass
    // that mapping and duplicate runtime modules, so Pi warns about it.
    for (const host of [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
      "typebox",
    ]) {
      expect(packageJson.dependencies).not.toHaveProperty(host);
      expect(packageJson.optionalDependencies ?? {}).not.toHaveProperty(host);
      expect(packageJson.bundledDependencies ?? []).not.toContain(host);
    }
  });
  it("requires typebox as a peer for the standalone CLI and library", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    expect(packageJson.peerDependencies.typebox).toBe("*");
    expect(packageJson.peerDependenciesMeta ?? {}).not.toHaveProperty(
      "typebox",
    );
    // A devDependency of the same name outranks the peer edge, so production
    // installs such as the Nix package would prune typebox and break the CLI.
    expect(packageJson.devDependencies).not.toHaveProperty("typebox");
  });
  it("keeps schema URLs on latest independently of the package version", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    const expectedSchemaUrl = `https://unpkg.com/${packageJson.name}@latest/dist/config.schema.json`;

    expect(packageJson.name).toBe("webfox");
    expect(packageJson.bin).toEqual({ web: "./dist/cli.js" });
    expect(packageJson.pi.extensions).toEqual(["./dist/pi.js"]);
    expect(PACKAGE_NAME).toBe(packageJson.name);
    expect(PACKAGE_VERSION).toBe(packageJson.version);
    expect(CONFIG_SCHEMA_URL).toBe(expectedSchemaUrl);

    const schema = JSON.parse(
      await readFile(resolve("src/config.schema.json"), "utf8"),
    );
    const example = parse(
      await readFile(resolve("example-config.yaml"), "utf8"),
    );
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(schema.$id).toBe(expectedSchemaUrl);
    expect(example.$schema).toBe(expectedSchemaUrl);
    expect(readme).toContain(`$schema: ${expectedSchemaUrl}`);
  });
});

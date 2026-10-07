import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// api gets an explicit environment in deploy/docker-compose.yml, not the whole .env. A variable env.ts reads but the
// list leaves out is silently unset in production: on 2026-10-07 SERVER_ADDRESS was missing, which switched off the
// guard that keeps Admin → Server → Router from removing the route players join by.
const envTs = readFileSync(new URL("../src/env.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../../deploy/docker-compose.yml", import.meta.url), "utf8");

/** Set by the image itself, never from deploy/.env. */
const FROM_THE_IMAGE = new Set(["PORT", "REPO_DIR", "MODPACK_PKG_DIR"]);

describe("api's environment in compose", () => {
  it("passes every variable env.ts reads", () => {
    const read = [...envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]+): z\./gm)].map((m) => m[1]!);
    expect(read.length).toBeGreaterThan(20);
    const api = compose.slice(compose.indexOf("\n  api:"));
    const block = api.slice(api.indexOf("\n    environment:"), api.indexOf("\n    volumes:"));
    const passed = new Set([...block.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!));
    expect(read.filter((k) => !FROM_THE_IMAGE.has(k) && !passed.has(k))).toEqual([]);
  });
});

import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Fix 1 (2026-10-07): the first deploy of the build designer stopped at "deepslate-web is unhealthy" because the
// path Docker's healthcheck calls waited on a designer that was not running. That path must answer on web and its
// database alone. Here the designer and api are hosts that take the connection and never answer.
let silent: Server;
const held: Array<{ destroy(): void }> = [];

beforeAll(async () => {
  silent = createServer((s) => void held.push(s));
  await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
  const { port } = silent.address() as { port: number };
  process.env.DESIGNER_URL = `http://127.0.0.1:${port}`;
  process.env.DESIGNER_TOKEN = "test-designer-token";
  process.env.API_URL = `http://127.0.0.1:${port}`;
  process.env.API_SERVICE_TOKEN = "test-service-token";
  process.env.DATABASE_URL = "postgresql://test@127.0.0.1:1/test";
  process.env.AUTH_SECRET = "test-secret";
  process.env.AUTH_URL = "http://localhost:3000";
});

afterAll(async () => {
  for (const s of held) s.destroy();
  await new Promise((done) => silent.close(done));
});

let dbAnswers: "now" | "never" = "now";
vi.mock("@/server/db", () => ({
  db: { $queryRaw: () => (dbAnswers === "now" ? Promise.resolve([{ "?column?": 1 }]) : new Promise(() => {})) },
}));

describe("the container healthcheck's path", () => {
  it("answers in under 2 s with ok true while the designer and api never answer", async () => {
    const { GET } = await import("@/app/api/health/live/route");
    const t = Date.now();
    const res = await GET();
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(held.length).toBe(0); // it never even asked them
  });

  it("says no, still within 2 s, when the database does not answer", async () => {
    dbAnswers = "never";
    const { GET } = await import("@/app/api/health/live/route");
    const t = Date.now();
    const res = await GET();
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    dbAnswers = "now";
  });

  it("is what Docker's healthcheck for web calls", () => {
    const compose = readFileSync(new URL("../../../deploy/docker-compose.yml", import.meta.url), "utf8");
    const web = compose.slice(compose.indexOf("\n  web:"), compose.indexOf("\n  wireguard:"));
    expect(web).toContain('"http://127.0.0.1:3000/api/health/live"');
    expect(web).not.toMatch(/3000\/api\/health"/);
  });
});

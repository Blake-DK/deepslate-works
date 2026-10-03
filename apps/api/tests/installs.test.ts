import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";

// Install reports for admins and the VPS session, read-only (Alex, 2026-10-03).
const seen: { where?: unknown; take?: number; writes: number } = { writes: 0 };
const report = {
  id: "cmgreport0001", at: new Date("2026-10-03T18:29:22Z"), mode: "unfinished", outcome: "failed", failedStep: null, installerVersion: "3.4.2",
  updatedFrom: null, updateProblem: null, packVersion: "0.1.0+d7521da9", durationSec: 9, tierBefore: "HIGH", tierMeasured: null, minimal: false,
  playLinkMissing: null, system: {}, log: Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join("\n"), user: { displayName: "Alex", mcUsername: "bramble09" },
};
vi.mock("../src/db.js", () => ({
  db: {
    installReport: {
      findMany: async (a: { where?: unknown; take?: number; select: Record<string, unknown> }) => {
        seen.where = a.where; seen.take = a.take;
        return [Object.fromEntries(Object.keys(a.select).map((k) => [k, report[k as keyof typeof report]]))]; // as Prisma does: only what is selected
      },
      findUnique: async (a: { where: { id: string } }) => (a.where.id === report.id ? report : null),
      create: async () => { seen.writes++; }, update: async () => { seen.writes++; }, delete: async () => { seen.writes++; },
    },
  },
}));
const { installRoutes } = await import("../src/routes/installs.js");

function app() {
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  installRoutes(f);
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1" });
  return { f, as };
}

describe("GET /installs", () => {
  it("lists reports newest first with mode, outcome and measured tier, no log", async () => {
    const { f, as } = app();
    const r = await f.inject({ method: "GET", url: "/installs?since=2026-10-03T18:26:00Z&until=2026-10-03T18:34:00Z&user=alex", headers: as("ADMIN") });
    expect(r.statusCode).toBe(200);
    const [row] = r.json().reports;
    expect(row).toMatchObject({ id: "cmgreport0001", mode: "unfinished", outcome: "failed", tierMeasured: null, who: "Alex", mcUsername: "bramble09" });
    expect(row.log).toBeUndefined();
    expect(seen.take).toBe(50);
    expect(JSON.stringify(seen.where)).toContain("2026-10-03T18:26:00.000Z");
  });
  it("refuses bad filters", async () => {
    const { f, as } = app();
    expect((await f.inject({ method: "GET", url: "/installs?limit=5000", headers: as("ADMIN") })).statusCode).toBe(400);
    expect((await f.inject({ method: "GET", url: "/installs?mode=drop%20table", headers: as("ADMIN") })).statusCode).toBe(400);
  });
  it("is for admins only and never writes", async () => {
    const { f, as } = app();
    expect((await f.inject({ method: "GET", url: "/installs", headers: as("PLAYER") })).statusCode).toBe(403);
    expect((await f.inject({ method: "GET", url: "/installs/cmgreport0001", headers: as("PLAYER") })).statusCode).toBe(403);
    expect((await f.inject({ method: "POST", url: "/installs", headers: as("ADMIN") })).statusCode).toBe(404);
    expect((await f.inject({ method: "DELETE", url: "/installs/cmgreport0001", headers: as("ADMIN") })).statusCode).toBe(404);
    expect(seen.writes).toBe(0);
  });
});

describe("GET /installs/:id", () => {
  it("gives the report with the last 400 lines of its log, or all of it with ?full=1", async () => {
    const { f, as } = app();
    const r = (await f.inject({ method: "GET", url: "/installs/cmgreport0001", headers: as("ADMIN") })).json();
    expect(r.logLines).toBe(450);
    expect(r.log.split("\n")).toHaveLength(400);
    expect(r.log.startsWith("line 51")).toBe(true);
    const full = (await f.inject({ method: "GET", url: "/installs/cmgreport0001?full=1", headers: as("ADMIN") })).json();
    expect(full.log.split("\n")).toHaveLength(450);
  });
  it("404 for an unknown id, 400 for a malformed one", async () => {
    const { f, as } = app();
    expect((await f.inject({ method: "GET", url: "/installs/cmgnothere0001", headers: as("ADMIN") })).statusCode).toBe(404);
    expect((await f.inject({ method: "GET", url: "/installs/..%2Fetc", headers: as("ADMIN") })).statusCode).toBe(400);
  });
});

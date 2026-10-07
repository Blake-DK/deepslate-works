import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { serviceAuth } from "../src/auth.js";
import { HttpRouterDash, MockRouterDash, RouterError, toView, type RouterDash } from "../src/router/client.js";
import { describeAction } from "../src/shared/events.js";

// Admin → Server → Router (Alex, 2026-10-07): the mc-router dashboard through api, admins only, changes audited.

const audits: Array<{ action: string; params: Record<string, unknown>; result: string; detail?: string | null }> = [];
vi.mock("../src/audit.js", () => ({ audit: async (a: (typeof audits)[number]) => void audits.push(a) }));
const { routerRoutes, protectedHost } = await import("../src/routes/router.js");

// What the dashboard answered on 2026-10-07, names and addresses replaced.
const overview = {
  routes: [
    { hostname: "boys.dsw.test", backend: "127.0.0.1:25567", port: 25567, label: "", probe: { backend: "127.0.0.1:25567", state: "down", version: null, motd: null, online: null, max: null, error: "nothing listening on the backend port" }, dns: { ips: ["203.0.113.7"], ok: true, checked: 1791347497.27 }, stats: { logins: 0, pings: 0, failed: 2, last: "2026-10-07T04:24:25.871Z" }, last_seen: "2026-10-07T04:24:25.871Z", online_players: [], instance: null },
    { hostname: "mc.dsw.test", backend: "127.0.0.1:25569", port: 25569, label: "Deepslate", probe: { state: "online", version: "1.21.1", motd: "Modded Minecraft with friends", online: 1, max: 20, error: null }, dns: { ips: ["203.0.113.7"], ok: true }, stats: { logins: 4, pings: 30, failed: 0 }, last_seen: "2026-10-07T12:00:00Z", online_players: ["Bramble09"], instance: null },
  ],
  router_ok: true, router_error: null, updated: "2026-10-07T12:00:05Z", free_ports: [25573, 25575],
  stats: { connects_24h: 40, logins_24h: 4, pings_24h: 30, rejected_24h: 2, players_24h: 1, clients_24h: 3, total_events: 99, hourly: [], online: [{ id: 1, client_host: "203.0.113.20", client_port: 50000, server: "mc.dsw.test", backend: "127.0.0.1:25569", player_name: "Bramble09", player_uuid: "00000000-0000-0000-0000-000000000000", started: "2026-10-07T11:50:00Z", ended: null }], unknown_hosts: [{ server: "203.0.113.7", n: 5, last: "2026-10-07T10:00:00Z", clients: 2 }] },
  instances: [], amp: { enabled: false, error: null }, cloudflare: { enabled: false, zone: "", target: "" },
  config: { public_ip: "203.0.113.7", public_port: 25565, backend_host: "127.0.0.1", port_min: 25566, port_max: 25599, retention_days: 30 },
};
const events = { events: [{ id: 9, ts: "2026-10-07T11:50:00Z", event: "connect", status: "success", kind: "login", client_host: "203.0.113.20", client_port: 50000, server: "mc.dsw.test", backend: "127.0.0.1:25569", player_name: "Bramble09", player_uuid: "00000000-0000-0000-0000-000000000000", error: null }] };

describe("toView", () => {
  it("keeps what the page shows, in the site's own names", () => {
    const v = toView(overview, events);
    expect(v.routerOk).toBe(true);
    expect(v.routes.map((r) => [r.hostname, r.port, r.state, r.label])).toEqual([["boys.dsw.test", 25567, "down", null], ["mc.dsw.test", 25569, "online", "Deepslate"]]);
    expect(v.routes[1]).toMatchObject({ version: "1.21.1", online: 1, max: 20, players: ["Bramble09"], dnsOk: true, logins: 4 });
    expect(v.routes[0]!.error).toBe("nothing listening on the backend port");
    expect(v).toMatchObject({ freePorts: [25573, 25575], portMin: 25566, portMax: 25599, day: { logins: 4, rejected: 2, players: 1 } });
    expect(v.online).toEqual([{ player: "Bramble09", server: "mc.dsw.test", since: "2026-10-07T11:50:00Z" }]);
    expect(v.unknownHosts).toEqual([{ hostname: "203.0.113.7", tries: 5, last: "2026-10-07T10:00:00Z" }]);
    expect(v.logins).toEqual([{ at: "2026-10-07T11:50:00Z", player: "Bramble09", server: "mc.dsw.test", ok: true, client: "203.0.113.20", error: null }]);
  });
  it("copes with fields the dashboard leaves out", () => {
    const v = toView({ routes: [{ hostname: "x.dsw.test" }] }, { events: [] });
    expect(v.routes[0]).toMatchObject({ hostname: "x.dsw.test", port: null, state: null, players: [], dnsOk: null });
    expect(v).toMatchObject({ routerOk: false, freePorts: [], online: [], logins: [] });
  });
  it("refuses an answer with no routes list", () => {
    expect(() => toView({}, { events: [] })).toThrow();
  });
});

function app(dash: RouterDash = new MockRouterDash(), serverAddress = "mc.dsw.test") {
  const f = Fastify();
  f.addHook("onRequest", serviceAuth("secret"));
  routerRoutes(f, dash, serverAddress);
  const as = (role: string) => ({ authorization: "Bearer secret", "x-user-role": role, "x-user-id": "u1" });
  return { f, as, dash };
}

describe("routes", () => {
  beforeEach(() => { audits.length = 0; });

  it("is for admins only", async () => {
    const { f, as } = app();
    expect((await f.inject({ method: "GET", url: "/router", headers: as("PLAYER") })).statusCode).toBe(403);
    expect((await f.inject({ method: "POST", url: "/router/routes", headers: as("PLAYER"), payload: { hostname: "a.dsw.test", port: 25573 } })).statusCode).toBe(403);
    expect((await f.inject({ method: "DELETE", url: "/router/routes/a.dsw.test", headers: as("PLAYER") })).statusCode).toBe(403);
    expect((await f.inject({ method: "GET", url: "/router" })).statusCode).toBe(401);
    expect(audits).toEqual([]);
  });

  it("shows the routes and which one is never removed", async () => {
    const { f, as } = app(undefined, "MC.dsw.test:25565");
    const r = await f.inject({ method: "GET", url: "/router", headers: as("ADMIN") });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ routerOk: true, protectedHost: "mc.dsw.test", routes: [{ hostname: "mc.dsw.test" }] });
  });

  it("adds a route, lower-cased, and audits it", async () => {
    const { f, as, dash } = app();
    const r = await f.inject({ method: "POST", url: "/router/routes", headers: as("ADMIN"), payload: { hostname: " Test.DSW.test ", port: 25573, label: "Test" } });
    expect(r.statusCode).toBe(200);
    expect((dash as MockRouterDash).routes.get("test.dsw.test")).toEqual({ port: 25573, label: "Test" });
    expect(audits).toEqual([{ userId: "u1", action: "router.routeAdd", params: { hostname: "test.dsw.test", port: 25573, label: "Test" }, result: "OK" }]);
  });

  it("refuses bad input before the dashboard sees it", async () => {
    const { f, as } = app();
    for (const payload of [{ hostname: "nodots", port: 25573 }, { hostname: "a.dsw.test/../x", port: 25573 }, { hostname: "a.dsw.test", port: 80 }, { hostname: "a.dsw.test", port: 25573.5 }, { hostname: "a.dsw.test", port: 25573, label: "x\u0007y" }, {}]) {
      expect((await f.inject({ method: "POST", url: "/router/routes", headers: as("ADMIN"), payload })).statusCode).toBe(400);
    }
    expect((await f.inject({ method: "DELETE", url: "/router/routes/not_a_host", headers: as("ADMIN") })).statusCode).toBe(400);
    expect(audits).toEqual([]);
  });

  it("passes on what the dashboard refused, and audits the failure", async () => {
    const { f, as } = app();
    const r = await f.inject({ method: "POST", url: "/router/routes", headers: as("ADMIN"), payload: { hostname: "mc.dsw.test", port: 25573 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toEqual({ code: "router_refused", message: "that hostname already has a route" });
    expect(audits[0]).toMatchObject({ action: "router.routeAdd", result: "FAILED", detail: "that hostname already has a route" });
  });

  it("never removes the address players join by", async () => {
    const { f, as, dash } = app();
    const r = await f.inject({ method: "DELETE", url: "/router/routes/MC.DSW.TEST", headers: as("ADMIN") });
    expect(r.statusCode).toBe(409);
    expect((dash as MockRouterDash).routes.has("mc.dsw.test")).toBe(true);
    expect(audits).toEqual([{ userId: "u1", action: "router.routeRemove", params: { hostname: "mc.dsw.test", refused: "server_address" }, result: "DENIED" }]);
  });

  it("removes another route and audits it", async () => {
    const { f, as, dash } = app();
    (dash as MockRouterDash).routes.set("old.dsw.test", { port: 25575 });
    expect((await f.inject({ method: "DELETE", url: "/router/routes/old.dsw.test", headers: as("ADMIN") })).statusCode).toBe(200);
    expect((dash as MockRouterDash).routes.has("old.dsw.test")).toBe(false);
    expect(audits).toEqual([{ userId: "u1", action: "router.routeRemove", params: { hostname: "old.dsw.test" }, result: "OK" }]);
  });

  it("says 503 when the dashboard cannot be reached", async () => {
    const down: RouterDash = { view: async () => { throw new RouterError(0, "the router dashboard cannot be reached"); }, addRoute: async () => {}, removeRoute: async () => {} };
    const { f, as } = app(down);
    const r = await f.inject({ method: "GET", url: "/router", headers: as("ADMIN") });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("router_unreachable");
  });

  it("an unset server address protects nothing", () => {
    expect(protectedHost(undefined)).toBeNull();
    expect(protectedHost(" ")).toBeNull();
  });

  it("reads as a line in the event log", () => {
    const alex = { role: "ADMIN" as const, name: "Alex" };
    expect(describeAction("router.routeAdd", alex, { hostname: "test.dsw.test", port: 25573, label: "Test" })).toBe("Alex added the game address test.dsw.test → port 25573 (Test)");
    expect(describeAction("router.routeRemove", alex, { hostname: "old.dsw.test" })).toBe("Alex removed the game address old.dsw.test");
    expect(describeAction("router.routeRemove", alex, { hostname: "mc.dsw.test", refused: "server_address" }, "DENIED")).toBe("Alex tried to remove the game address mc.dsw.test, the one players join by (refused)");
  });
});

describe("HttpRouterDash", () => {
  const seen: Array<{ method: string; url: string; body: string; type: string | undefined }> = [];
  let answer: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { seen.push({ method: req.method!, url: req.url!, body, type: req.headers["content-type"] }); answer(req, res); });
  });
  let base = "";
  beforeAll(async () => { await new Promise<void>((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  beforeEach(() => { seen.length = 0; });
  const json = (res: ServerResponse, code: number, v: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };

  it("reads the overview and the last 20 logins", async () => {
    answer = (req, res) => json(res, 200, req.url!.startsWith("/api/events") ? events : overview);
    const v = await new HttpRouterDash(`${base}/`).view();
    expect(v.routes).toHaveLength(2);
    expect(seen.map((s) => `${s.method} ${s.url}`).sort()).toEqual(["GET /api/events?kind=login&limit=20", "GET /api/overview"]);
  });

  it("adds with JSON and removes by an encoded name; never /hook", async () => {
    answer = (_req, res) => json(res, 200, { ok: true });
    const d = new HttpRouterDash(base);
    await d.addRoute({ hostname: "test.dsw.test", port: 25573 });
    await d.removeRoute("test.dsw.test");
    expect(seen).toEqual([
      { method: "POST", url: "/api/routes", body: JSON.stringify({ hostname: "test.dsw.test", port: 25573 }), type: "application/json" },
      { method: "DELETE", url: "/api/routes/test.dsw.test", body: "", type: undefined },
    ]);
  });

  it("brings back the dashboard's own words for a refusal", async () => {
    answer = (_req, res) => json(res, 400, { error: "port 25569 is already used by mc.dsw.test" });
    await expect(new HttpRouterDash(base).addRoute({ hostname: "x.dsw.test", port: 25569 })).rejects.toMatchObject({ status: 400, message: "port 25569 is already used by mc.dsw.test" });
  });

  it("gives up after the timeout, and says so", async () => {
    answer = () => {}; // never answers
    await expect(new HttpRouterDash(base, 200).view()).rejects.toMatchObject({ status: 0, message: "the router dashboard did not answer in time" });
  });

  it("says when nothing listens", async () => {
    await expect(new HttpRouterDash("http://127.0.0.1:1").view()).rejects.toMatchObject({ status: 0, message: "the router dashboard cannot be reached" });
  });
});

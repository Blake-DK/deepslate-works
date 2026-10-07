import { z } from "zod";

// The mc-router dashboard on the AMP host (docs/17, docs/02 "mc-router on Admin → Server"): routes from a hostname to
// a game port, who is connecting, free ports. It has no login of its own and is reached only from here, over the
// tunnel; web never talks to it. Every call has a timeout; what it answers is read through the schemas below, so a
// field it drops or renames shows as "unknown" on the page instead of breaking it.

const str = z.string().nullish().transform((v) => v ?? null);
const num = z.number().nullish().transform((v) => v ?? null);

const routeSchema = z.object({
  hostname: z.string(),
  port: num,
  label: str,
  probe: z.object({ state: str, version: str, motd: str, online: num, max: num, error: str }).partial().nullish(),
  dns: z.object({ ok: z.boolean().nullish() }).partial().nullish(),
  stats: z.object({ logins: num, pings: num, failed: num }).partial().nullish(),
  last_seen: str,
  online_players: z.array(z.string()).nullish(),
});

const overviewSchema = z.object({
  routes: z.array(routeSchema),
  router_ok: z.boolean().nullish(),
  router_error: str,
  updated: str,
  free_ports: z.array(z.number()).nullish(),
  stats: z.object({
    logins_24h: num, pings_24h: num, rejected_24h: num, players_24h: num,
    online: z.array(z.object({ player_name: str, server: str, started: str })).nullish(),
    unknown_hosts: z.array(z.object({ server: str, n: num, last: str })).nullish(),
  }).partial().nullish(),
  config: z.object({ port_min: num, port_max: num }).partial().nullish(),
});

const eventsSchema = z.object({
  events: z.array(z.object({ ts: str, event: str, status: str, server: str, player_name: str, client_host: str, error: str })),
});

export type RouterRoute = {
  hostname: string; port: number | null; label: string | null;
  state: string | null; version: string | null; motd: string | null; online: number | null; max: number | null; error: string | null;
  dnsOk: boolean | null; players: string[]; logins: number | null; failed: number | null; lastSeen: string | null;
};
export type RouterLogin = { at: string | null; player: string | null; server: string | null; ok: boolean; client: string | null; error: string | null };
export type RouterView = {
  routerOk: boolean; routerError: string | null; updated: string | null;
  routes: RouterRoute[];
  freePorts: number[]; portMin: number | null; portMax: number | null;
  day: { logins: number | null; pings: number | null; rejected: number | null; players: number | null };
  online: Array<{ player: string | null; server: string | null; since: string | null }>;
  unknownHosts: Array<{ hostname: string | null; tries: number | null; last: string | null }>;
  logins: RouterLogin[];
};

/** The dashboard said no (4xx/5xx with its own words), or could not be reached at all (status 0). */
export class RouterError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface RouterDash {
  view(): Promise<RouterView>;
  addRoute(r: { hostname: string; port: number; label?: string }): Promise<void>;
  removeRoute(hostname: string): Promise<void>;
}

export function toView(overview: unknown, events: unknown): RouterView {
  const o = overviewSchema.parse(overview);
  const e = eventsSchema.parse(events);
  return {
    routerOk: o.router_ok === true,
    routerError: o.router_error,
    updated: o.updated,
    routes: o.routes.map((r) => ({
      hostname: r.hostname, port: r.port, label: r.label || null,
      state: r.probe?.state ?? null, version: r.probe?.version ?? null, motd: r.probe?.motd ?? null,
      online: r.probe?.online ?? null, max: r.probe?.max ?? null, error: r.probe?.error ?? null,
      dnsOk: r.dns?.ok ?? null, players: r.online_players ?? [], logins: r.stats?.logins ?? null, failed: r.stats?.failed ?? null, lastSeen: r.last_seen,
    })),
    freePorts: o.free_ports ?? [],
    portMin: o.config?.port_min ?? null,
    portMax: o.config?.port_max ?? null,
    day: { logins: o.stats?.logins_24h ?? null, pings: o.stats?.pings_24h ?? null, rejected: o.stats?.rejected_24h ?? null, players: o.stats?.players_24h ?? null },
    online: (o.stats?.online ?? []).map((p) => ({ player: p.player_name, server: p.server, since: p.started })),
    unknownHosts: (o.stats?.unknown_hosts ?? []).map((u) => ({ hostname: u.server, tries: u.n, last: u.last })),
    logins: e.events.map((x) => ({ at: x.ts, player: x.player_name, server: x.server, ok: x.status === "success", client: x.client_host, error: x.error })),
  };
}

export class HttpRouterDash implements RouterDash {
  constructor(private base: string, private timeoutMs = 8_000) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new RouterError(0, e instanceof Error && e.name === "TimeoutError" ? "the router dashboard did not answer in time" : "the router dashboard cannot be reached");
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: said below */ }
    if (!res.ok) {
      const said = json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string" ? (json as { error: string }).error : `HTTP ${res.status}`;
      throw new RouterError(res.status, said.slice(0, 300));
    }
    if (json === null) throw new RouterError(502, "the router dashboard did not answer with JSON");
    return json;
  }

  async view(): Promise<RouterView> {
    const [overview, events] = await Promise.all([this.call("GET", "/api/overview"), this.call("GET", "/api/events?kind=login&limit=20")]);
    try {
      return toView(overview, events);
    } catch {
      throw new RouterError(502, "the router dashboard answered in a shape this site does not know");
    }
  }

  async addRoute(r: { hostname: string; port: number; label?: string }) {
    await this.call("POST", "/api/routes", { hostname: r.hostname, port: r.port, ...(r.label ? { label: r.label } : {}) });
  }

  async removeRoute(hostname: string) {
    await this.call("DELETE", `/api/routes/${encodeURIComponent(hostname)}`);
  }
}

/** For AMP_MOCK=1 and the tests: one route per name, all of them up. */
export class MockRouterDash implements RouterDash {
  routes = new Map<string, { port: number; label?: string }>([["mc.dsw.test", { port: 25569 }]]);
  async view(): Promise<RouterView> {
    return {
      routerOk: true, routerError: null, updated: new Date().toISOString(),
      routes: [...this.routes].map(([hostname, r]) => ({ hostname, port: r.port, label: r.label ?? null, state: "online", version: "1.21.1", motd: "Deepslate Works", online: 0, max: 20, error: null, dnsOk: true, players: [], logins: 0, failed: 0, lastSeen: null })),
      freePorts: [25573, 25575], portMin: 25566, portMax: 25599,
      day: { logins: 0, pings: 0, rejected: 0, players: 0 }, online: [], unknownHosts: [], logins: [],
    };
  }
  async addRoute(r: { hostname: string; port: number; label?: string }) {
    if (this.routes.has(r.hostname)) throw new RouterError(400, "that hostname already has a route");
    this.routes.set(r.hostname, { port: r.port, label: r.label });
  }
  async removeRoute(hostname: string) {
    if (!this.routes.delete(hostname)) throw new RouterError(404, "no such route");
  }
}

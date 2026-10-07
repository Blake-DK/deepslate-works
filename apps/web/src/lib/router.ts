// Admin → Server → Router: what api's GET /router answers (apps/api/src/router/client.ts), and how the page says it.

export type RouterRoute = {
  hostname: string; port: number | null; label: string | null;
  state: string | null; version: string | null; motd: string | null; online: number | null; max: number | null; error: string | null;
  dnsOk: boolean | null; players: string[]; logins: number | null; failed: number | null; lastSeen: string | null;
};
export type RouterView = {
  routerOk: boolean; routerError: string | null; updated: string | null;
  routes: RouterRoute[];
  freePorts: number[]; portMin: number | null; portMax: number | null;
  day: { logins: number | null; pings: number | null; rejected: number | null; players: number | null };
  online: Array<{ player: string | null; server: string | null; since: string | null }>;
  unknownHosts: Array<{ hostname: string | null; tries: number | null; last: string | null }>;
  logins: Array<{ at: string | null; player: string | null; server: string | null; ok: boolean; client: string | null; error: string | null }>;
  protectedHost: string | null;
};

export type Tone = "good" | "warn" | "bad" | "neutral";

/** The dashboard's probe of the game server behind a route: online, listening (port open, no Minecraft answer yet), down. */
export function stateText(state: string | null): { text: string; tone: Tone } {
  if (state === "online") return { text: "Up", tone: "good" };
  if (state === "listening") return { text: "Port open, not answering yet", tone: "warn" };
  if (state === "down") return { text: "Down", tone: "bad" };
  return { text: "Unknown", tone: "neutral" };
}

/** "3 / 20 playing", or nothing when the server did not say. */
export function playersText(r: Pick<RouterRoute, "online" | "max">): string | null {
  if (r.online === null) return null;
  return r.max === null ? `${r.online} playing` : `${r.online} / ${r.max} playing`;
}

/** The port the add form suggests: the dashboard's first free one. */
export function suggestedPort(v: Pick<RouterView, "freePorts">): number | undefined {
  return v.freePorts[0];
}

import { instancePath } from "./paths.js";

// AMP ApplicationState (verified against the live instance 2026-09-28: 0 = Stopped, 20 = Ready/Running).
export const AMP_STATE: Record<number, string> = {
  [-1]: "Undefined", 0: "Stopped", 5: "PreStart", 7: "Configuring", 10: "Starting", 20: "Running", 30: "Sleeping", 40: "Restarting",
  45: "Stopping", 50: "PreparingForSleep", 60: "Waiting", 100: "Failed", 200: "Suspended", 250: "Maintenance", 999: "Indeterminate",
};

export type AmpStatus = {
  state: string;
  stateCode?: number | null;
  players: string[];
  maxPlayers?: number | null;
  cpu: number | null;
  memMb: number | null;
  memMaxMb?: number | null;
  tps?: number | null;
  uptime: string | null;
  raw?: unknown;
};

/** What the portal shows. Sleeping is AMP's idle mode: the server wakes when someone connects. */
export type Availability = "online" | "starting" | "sleeping" | "offline";
export function availability(stateCode: number | null | undefined): Availability {
  switch (stateCode) {
    case 20: return "online";
    case 5: case 7: case 10: case 40: case 60: return "starting";
    case 30: case 50: return "sleeping";
    default: return "offline";
  }
}

export interface Amp {
  /** Verifies that AMP answers and the login works; throws on failure. Must not start a new session when there is one. */
  ping(): Promise<void>;
  /** How many times this client has logged in. A new AMP session is handed the recent console lines all over again. */
  readonly sessions?: number;
  /**
   * Does the portal's user have this permission? AMP fixes a session's permissions when it logs in, so a "no" from
   * a session that has been open for a while may be out of date: on a "no" the client logs in again (once a minute
   * at most) and asks once more. 2026-09-29: Alex granted a permission and the portal went on saying it had not got it.
   */
  hasPermission?(node: string): Promise<boolean>;
  getStatus(): Promise<AmpStatus>;
  /** Any instance call. Console commands must only be built by the action registry. */
  call<T = unknown>(module: string, method: string, params?: Record<string, unknown>): Promise<T>;
}

type Opts = { url: string; username: string; password: string; instanceId: string; timeoutMs?: number };

const UNAUTHORIZED = /unauthori[sz]ed|session/i;

/**
 * What AMP answers, with HTTP 200, to a session it no longer knows (after ADS has been restarted, say):
 * {"Status": false, "Reason": "You do not have permission to use this method (…) at this time. This method requires
 * the Session.Exists permission."}. A permission the user really lacks names that permission instead.
 */
export function sessionGone(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { Status?: unknown; Reason?: unknown; Title?: unknown; Message?: unknown };
  const said = [b.Reason, b.Message, b.Title].filter((v): v is string => typeof v === "string").join(" ");
  return /requires the Session\.Exists permission/i.test(said);
}

export class AmpClient implements Amp {
  private sessionId: string | null = null;
  sessions = 0;
  constructor(private readonly o: Opts) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.o.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
    });
    if (res.status === 401) throw new Error("Unauthorized");
    if (!res.ok) throw new Error(`AMP ${path} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** `webapp` is an instance-local user, so even Login goes through the ADS proxy path (docs/13 §4, corrected 2026-09-28). */
  async login(): Promise<void> {
    const r = await this.post<{ success?: boolean; sessionID?: string; resultReason?: string }>(instancePath(this.o.instanceId, "Core", "Login"), {
      username: this.o.username, password: this.o.password, token: "", rememberMe: false,
    });
    if (!r.success || !r.sessionID) throw new Error(`AMP login failed: ${r.resultReason ?? "unknown"}`);
    this.sessionId = r.sessionID;
    this.sessions++;
  }

  async call<T = unknown>(module: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.sessionId) await this.login();
    const path = instancePath(this.o.instanceId, module, method);
    let answer: T;
    try {
      answer = await this.post<T>(path, { ...params, SESSIONID: this.sessionId });
      if (!sessionGone(answer)) return answer;
    } catch (e) {
      if (!(e instanceof Error) || !UNAUTHORIZED.test(e.message)) throw e;
    }
    this.sessionId = null; // expired, or AMP has forgotten it; one retry
    await this.login();
    answer = await this.post<T>(path, { ...params, SESSIONID: this.sessionId });
    if (sessionGone(answer)) throw new Error("AMP does not accept the session it has just given out");
    return answer;
  }

  private lastFresh = 0;

  async hasPermission(node: string): Promise<boolean> {
    if ((await this.call<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: node })) === true) return true;
    if (Date.now() - this.lastFresh < 60_000) return false;
    this.lastFresh = Date.now();
    this.sessionId = null;
    await this.login();
    return (await this.call<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: node })) === true;
  }

  async ping() {
    // Over the session there is; `call` logs in when there is none or it has run out. Until 2026-09-29 this logged
    // in afresh on every health check (every 30 s), and each new session made AMP send the last console lines
    // again: a join line was read as a new join each time, and the player was let in, and moved, again and again.
    await this.call("Core", "GetStatus");
  }

  async getStatus(): Promise<AmpStatus> {
    // Shapes recorded from the live instance (docs/08 "AMP methods used").
    type Metric = { RawValue?: number; MaxValue?: number; Percent?: number; Units?: string };
    const r = await this.call<{ State?: number; Uptime?: string; Metrics?: Record<string, Metric> }>("Core", "GetStatus");
    const users = await this.call<Record<string, string>>("Core", "GetUserList").catch(() => ({}) as Record<string, string>);
    const players = Object.values(users ?? {}).filter((v): v is string => typeof v === "string");
    const running = r.State === 20;
    return {
      state: typeof r.State === "number" ? (AMP_STATE[r.State] ?? `State${r.State}`) : "Unknown",
      stateCode: typeof r.State === "number" ? r.State : null,
      players,
      maxPlayers: r.Metrics?.["Active Users"]?.MaxValue ?? null,
      cpu: r.Metrics?.["CPU Usage"]?.RawValue ?? null,
      memMb: r.Metrics?.["Memory Usage"]?.RawValue ?? null,
      memMaxMb: r.Metrics?.["Memory Usage"]?.MaxValue ?? null,
      // AMP reports 0 TPS for a server that is not running; that is "no reading", not a bad one.
      tps: running ? (r.Metrics?.["TPS"]?.RawValue ?? null) : null,
      uptime: r.Uptime ?? null,
      raw: r,
    };
  }
}

/** Runs the whole stack before the instance exists. */
export class MockAmp implements Amp {
  async ping() {}
  async getStatus(): Promise<AmpStatus> {
    return { state: "Running", stateCode: 20, players: ["Alex"], maxPlayers: 20, cpu: 12, memMb: 3100, memMaxMb: 6144, tps: 20, uptime: "01:23:45" };
  }
  async call<T>(): Promise<T> {
    return {} as T;
  }
}

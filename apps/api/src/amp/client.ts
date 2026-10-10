import { instancePath } from "./paths.js";

// AMP ApplicationState (verified against the live instance: 2026-09-28 0 = Stopped, 20 = Ready/Running; 2026-10-08 a
// sleeping instance reports 50, docs/11). 30, 40, 45 and 50 had been swapped until 2026-10-10 (docs/47 §5.7).
export const AMP_STATE: Record<number, string> = {
  [-1]: "Undefined", 0: "Stopped", 5: "PreStart", 7: "Configuring", 10: "Starting", 20: "Running", 30: "Restarting", 40: "Stopping",
  45: "PreparingForSleep", 50: "Sleeping", 60: "Waiting", 100: "Failed", 200: "Suspended", 250: "Maintenance", 999: "Indeterminate",
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
    case 5: case 7: case 10: case 30: case 60: return "starting";
    case 45: case 50: return "sleeping";
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
  /**
   * The same call, with the login it was answered under (the value `sessions` had when the request went out).
   * The console tail needs it: `sessions` read after the call may already count a login made by another caller.
   */
  callTagged?<T = unknown>(module: string, method: string, params?: Record<string, unknown>): Promise<{ answer: T; session: number }>;
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

  /**
   * The session goes in `Authorization: Bearer`, never in the body: AMP 2.8 logs "SessionID passed in request body -
   * this is deprecated" for every call that sends `SESSIONID` (seen 2026-10-03, once per poll). Login has no session.
   */
  private async post<T>(path: string, body: Record<string, unknown>, sessionId?: string | null): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (sessionId) headers.authorization = `Bearer ${sessionId}`;
    const res = await fetch(`${this.o.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
    });
    if (res.status === 401) throw new Error("Unauthorized");
    if (!res.ok) throw new Error(`AMP ${path} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** `webapp` is an instance-local user, so even Login goes through the ADS proxy path (docs/13 §4, corrected 2026-09-28). */
  private loggingIn: Promise<void> | null = null;

  /**
   * One login at a time (docs/31 B-41). Two callers that met a dead session at once each used to log in for
   * themselves; the second login made AMP hand out its last console lines again under a session the tail did not
   * know it was on, and old joins were acted on as new. Whoever asks while a login is under way waits for that one.
   */
  login(): Promise<void> {
    this.loggingIn ??= this.logInOnce().finally(() => { this.loggingIn = null; });
    return this.loggingIn;
  }

  private async logInOnce(): Promise<void> {
    const r = await this.post<{ success?: boolean; sessionID?: string; resultReason?: string }>(instancePath(this.o.instanceId, "Core", "Login"), {
      username: this.o.username, password: this.o.password, token: "", rememberMe: false,
    });
    if (!r.success || !r.sessionID) throw new Error(`AMP login failed: ${r.resultReason ?? "unknown"}`);
    this.sessionId = r.sessionID;
    this.sessions++;
  }

  async call<T = unknown>(module: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await this.callTagged<T>(module, method, params)).answer;
  }

  async callTagged<T = unknown>(module: string, method: string, params: Record<string, unknown> = {}): Promise<{ answer: T; session: number }> {
    if (!this.sessionId) await this.login();
    const path = instancePath(this.o.instanceId, module, method);
    const used = this.sessionId;
    let session = this.sessions;
    let answer: T;
    try {
      answer = await this.post<T>(path, params, used);
      if (!sessionGone(answer)) return { answer, session };
    } catch (e) {
      if (!(e instanceof Error) || !UNAUTHORIZED.test(e.message)) throw e;
    }
    // expired, or AMP has forgotten it; one retry. If another caller has logged in again meanwhile, that session is used.
    if (this.sessionId === used) this.sessionId = null;
    if (!this.sessionId) await this.login();
    session = this.sessions;
    answer = await this.post<T>(path, params, this.sessionId);
    if (sessionGone(answer)) throw new Error("AMP does not accept the session it has just given out");
    return { answer, session };
  }

  /** The session number each permission was last refused on (3.6.1). */
  private readonly refused = new Map<string, number>();

  /**
   * Asked over the session there is. A refusal is remembered for that session, and never answered with a new login
   * (3.6.1): until 2026-10-09 a "no" threw the session away and logged in again, at most once a minute, so that a
   * permission granted meanwhile was seen. The test site asks for a backup list its AMP user may not see every 30 s,
   * so the test api's session was replaced every 60 to 90 s: each new session makes AMP send its last console lines
   * again, the door resyncs, and the poller was without a session in between ("unreachable"). A permission granted in
   * AMP is now seen from the api's next session (a restart or a deploy).
   */
  async hasPermission(node: string): Promise<boolean> {
    if (this.sessionId && this.refused.get(node) === this.sessions) return false;
    const { answer, session } = await this.callTagged<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: node });
    if (answer === true) { this.refused.delete(node); return true; }
    this.refused.set(node, session);
    return false;
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

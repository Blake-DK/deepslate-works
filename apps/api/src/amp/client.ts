import { instancePath } from "./paths.js";

// AMP ApplicationState (verified against the live instance 2026-09-28: 0 = Stopped, 20 = Ready/Running).
export const AMP_STATE: Record<number, string> = {
  [-1]: "Undefined", 0: "Stopped", 5: "PreStart", 7: "Configuring", 10: "Starting", 20: "Running", 30: "Sleeping", 40: "Restarting",
  45: "Stopping", 50: "PreparingForSleep", 60: "Waiting", 100: "Failed", 200: "Suspended", 250: "Maintenance", 999: "Indeterminate",
};

export type AmpStatus = {
  state: string;
  players: string[];
  cpu: number | null;
  memMb: number | null;
  memMaxMb?: number | null;
  uptime: string | null;
  raw?: unknown;
};

export interface Amp {
  /** Verifies login works; throws on failure. */
  ping(): Promise<void>;
  getStatus(): Promise<AmpStatus>;
  /** Any instance call. Console commands must only be built by the action registry. */
  call<T = unknown>(module: string, method: string, params?: Record<string, unknown>): Promise<T>;
}

type Opts = { url: string; username: string; password: string; instanceId: string; timeoutMs?: number };

const UNAUTHORIZED = /unauthori[sz]ed|session/i;

export class AmpClient implements Amp {
  private sessionId: string | null = null;
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
  }

  async call<T = unknown>(module: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.sessionId) await this.login();
    const path = instancePath(this.o.instanceId, module, method);
    try {
      return await this.post<T>(path, { ...params, SESSIONID: this.sessionId });
    } catch (e) {
      if (!(e instanceof Error) || !UNAUTHORIZED.test(e.message)) throw e;
      this.sessionId = null; // expired; one retry
      await this.login();
      return this.post<T>(path, { ...params, SESSIONID: this.sessionId });
    }
  }

  async ping() {
    await this.login();
  }

  async getStatus(): Promise<AmpStatus> {
    // Shapes recorded from the live instance (docs/08 "AMP methods used").
    type Metric = { RawValue?: number; MaxValue?: number; Percent?: number; Units?: string };
    const r = await this.call<{ State?: number; Uptime?: string; Metrics?: Record<string, Metric> }>("Core", "GetStatus");
    const users = await this.call<Record<string, string>>("Core", "GetUserList").catch(() => ({}) as Record<string, string>);
    const players = Object.values(users ?? {}).filter((v): v is string => typeof v === "string");
    return {
      state: typeof r.State === "number" ? (AMP_STATE[r.State] ?? `State${r.State}`) : "Unknown",
      players,
      cpu: r.Metrics?.["CPU Usage"]?.RawValue ?? null,
      memMb: r.Metrics?.["Memory Usage"]?.RawValue ?? null,
      memMaxMb: r.Metrics?.["Memory Usage"]?.MaxValue ?? null,
      uptime: r.Uptime ?? null,
      raw: r,
    };
  }
}

/** Runs the whole stack before the instance exists. */
export class MockAmp implements Amp {
  async ping() {}
  async getStatus(): Promise<AmpStatus> {
    return { state: "Running", players: ["Alex"], cpu: 12, memMb: 3100, memMaxMb: 6144, uptime: "01:23:45" };
  }
  async call<T>(): Promise<T> {
    return {} as T;
  }
}

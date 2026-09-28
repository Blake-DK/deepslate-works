import { adsPath, instancePath } from "./paths.js";

export type AmpStatus = {
  state: string;
  players: string[];
  cpu: number | null;
  memMb: number | null;
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

  async login(): Promise<void> {
    const r = await this.post<{ success?: boolean; sessionID?: string; resultReason?: string }>(adsPath("Core", "Login"), {
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
    // Shape to be confirmed against the live /API listing (docs/08 "AMP methods used").
    const r = await this.call<{ State?: number | string; Metrics?: Record<string, { RawValue?: number }>; Uptime?: string }>("Core", "GetStatus");
    return {
      state: String(r.State ?? "Unknown"),
      players: [],
      cpu: r.Metrics?.["CPU Usage"]?.RawValue ?? null,
      memMb: r.Metrics?.["Memory Usage"]?.RawValue ?? null,
      uptime: r.Uptime ?? null,
      raw: r,
    };
  }
}

/** Runs the whole stack before the instance exists. */
export class MockAmp implements Amp {
  async ping() {}
  async getStatus(): Promise<AmpStatus> {
    return { state: "Running", players: ["Alex"], cpu: 12, memMb: 3100, uptime: "01:23:45" };
  }
  async call<T>(): Promise<T> {
    return {} as T;
  }
}

import "server-only";
import { env } from "@/env";

// The only way `web` talks to the homelab side: api (deepslate-wg:4000) with the service token.
type Caller = { id: string; role: "ADMIN" | "PLAYER"; mcUsername?: string | null };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; caller?: Caller; timeoutMs?: number } = {}): Promise<T> {
  if (!env.API_URL || !env.API_SERVICE_TOKEN) throw new ApiError(503, "api_unconfigured", "Backend not configured");
  const headers: Record<string, string> = { authorization: `Bearer ${env.API_SERVICE_TOKEN}`, accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.caller) {
    headers["x-user-id"] = opts.caller.id;
    headers["x-user-role"] = opts.caller.role;
    if (opts.caller.mcUsername) headers["x-mc-username"] = opts.caller.mcUsername;
  }
  const res = await fetch(`${env.API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "api_error", json?.error?.message ?? `api ${path} -> ${res.status}`);
  return json as T;
}

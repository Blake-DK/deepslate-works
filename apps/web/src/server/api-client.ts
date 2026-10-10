import "server-only";
import { env } from "@/env";

// The only way `web` talks to the homelab side: api (deepslate-wg:4000) with the service token.
type Caller = { id: string; role: "ADMIN" | "PLAYER"; mcUsername?: string | null };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

type Opts = { method?: "GET" | "POST" | "DELETE"; body?: unknown; caller?: Caller; timeoutMs?: number; signal?: AbortSignal };

function request(path: string, opts: Opts, accept: string) {
  if (!env.API_URL || !env.API_SERVICE_TOKEN) throw new ApiError(503, "api_unconfigured", "Backend not configured");
  const headers: Record<string, string> = { authorization: `Bearer ${env.API_SERVICE_TOKEN}`, accept };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.caller) {
    headers["x-user-id"] = opts.caller.id;
    headers["x-user-role"] = opts.caller.role;
    if (opts.caller.mcUsername) headers["x-mc-username"] = opts.caller.mcUsername;
  }
  return fetch(`${env.API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 8000)]) : AbortSignal.timeout(opts.timeoutMs ?? 8000),
    cache: "no-store",
  });
}

async function fail(path: string, res: Response): Promise<never> {
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  throw new ApiError(res.status, json?.error?.code ?? "api_error", json?.error?.message ?? `api ${path} -> ${res.status}`);
}

export async function apiFetch<T>(path: string, opts: Opts = {}): Promise<T> {
  const res = await request(path, opts, "application/json");
  if (!res.ok) return fail(path, res);
  return (await res.json().catch(() => null)) as T;
}

/** The response as it comes, for passing a file through. The caller checks `ok`; use `apiError` to read a refusal. */
export async function apiRaw(path: string, opts: Opts = {}): Promise<Response> {
  return request(path, opts, "*/*");
}

export async function apiError(path: string, res: Response): Promise<ApiError> {
  return fail(path, res).catch((e: unknown) => (e instanceof ApiError ? e : new ApiError(res.status, "api_error", String(e))));
}

/** For api routes that answer with newline-delimited JSON while they work: yields each object as it arrives. */
export async function* apiStream<T>(path: string, opts: Opts = {}): AsyncGenerator<T> {
  const res = await request(path, opts, "application/x-ndjson");
  if (!res.ok) return fail(path, res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) yield JSON.parse(l) as T;
    }
    if (buf.trim()) yield JSON.parse(buf) as T;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * docs/42 T9, the live site only: the test server's api, for the Admin → Overview card. Its own address and its own token
 * (TEST_SUMMARY_TOKEN), which api-test takes for GET /test/summary and nothing else; null while the test server is off.
 */
export async function testServerSummary<T>(timeoutMs = 4000): Promise<T | null> {
  if (env.TEST_MODE || !env.TEST_STACK || !env.TEST_SUMMARY_TOKEN) return null;
  const res = await fetch(`${env.TEST_API_URL}/test/summary`, { headers: { authorization: `Bearer ${env.TEST_SUMMARY_TOKEN}`, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) return fail("/test/summary", res);
  return (await res.json()) as T;
}

/**
 * docs/45, the live site only: the launcher's Test section, asked of the test server's api on behalf of an admin's app.
 * Its own token (TEST_APP_TOKEN), which api-test takes for /test/app/* and nothing else. The answer is passed back as it
 * is (a stream for config.zip). Null while the test server is off or the token is not set; never on the test site.
 */
export async function testAppCall(pathname: "/test/app/pack" | "/test/app/config.zip" | "/test/app/state" | "/test/app/wake", init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<Response | null> {
  if (env.TEST_MODE || !env.TEST_STACK || !env.TEST_APP_TOKEN || env.TEST_APP_TOKEN.length < 32) return null;
  return fetch(`${env.TEST_API_URL}${pathname}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${env.TEST_APP_TOKEN}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    cache: "no-store",
  }).catch(() => null);
}

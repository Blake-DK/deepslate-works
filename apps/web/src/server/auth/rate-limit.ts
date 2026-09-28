// Tiny in-memory sliding-window limiter. One web container, a few dozen users;
// this does not need Redis. Caddy on this VPS has no rate_limit module, so the
// login and invite limits from docs/04-auth.md live here.
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // crude memory guard
    return true;
  }
}

const g = globalThis as unknown as { __dwLimiters?: Record<string, RateLimiter> };
g.__dwLimiters ??= {};
const limiter = (name: string, limit: number, windowMs: number) =>
  (g.__dwLimiters![name] ??= new RateLimiter(limit, windowMs));

export const loginLimiter = limiter("login", 10, 60_000);
export const inviteLimiter = limiter("invite", 10, 60_000);

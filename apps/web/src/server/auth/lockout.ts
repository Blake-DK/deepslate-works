// Admin password sign-in (planner, 2026-10-01): 5 failed attempts per username and 20 per address within 15 minutes,
// then that username (or address) is locked for 15 minutes. Only failures count. In memory, like the other limits
// here (one web container; a restart forgets, which at this scale is fine).

export class Lockout {
  private fails = new Map<string, number[]>();
  private until = new Map<string, number>();
  constructor(readonly limit: number, readonly windowMs: number, readonly lockMs: number) {}

  /** When the lock on this key ends, or null when it is not locked. */
  lockedUntil(key: string, now: number = Date.now()): number | null {
    const u = this.until.get(key);
    if (u === undefined) return null;
    if (u <= now) {
      this.until.delete(key);
      this.fails.delete(key);
      return null;
    }
    return u;
  }

  /** Counts a failure; true when this one locks the key. */
  fail(key: string, now: number = Date.now()): boolean {
    const recent = (this.fails.get(key) ?? []).filter((t) => t > now - this.windowMs);
    recent.push(now);
    this.fails.set(key, recent);
    if (this.fails.size > 10_000) this.fails.clear(); // crude memory guard, as in rate-limit.ts
    if (recent.length >= this.limit) {
      this.until.set(key, now + this.lockMs);
      return true;
    }
    return false;
  }

  failures(key: string, now: number = Date.now()): number {
    return (this.fails.get(key) ?? []).filter((t) => t > now - this.windowMs).length;
  }

  clear(key: string): void {
    this.fails.delete(key);
    this.until.delete(key);
  }
}

export const ADMIN_SIGNIN_LIMITS = {
  perUsername: { limit: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  perAddress: { limit: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
} as const;

export type AdminLockouts = { user: Lockout; ip: Lockout };

export function newAdminLockouts(): AdminLockouts {
  const { perUsername: u, perAddress: a } = ADMIN_SIGNIN_LIMITS;
  return { user: new Lockout(u.limit, u.windowMs, u.lockMs), ip: new Lockout(a.limit, a.windowMs, a.lockMs) };
}

const g = globalThis as unknown as { __dwAdminLockouts?: AdminLockouts };
export const adminLockouts = (g.__dwAdminLockouts ??= newAdminLockouts());

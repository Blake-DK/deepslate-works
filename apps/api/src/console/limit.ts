/**
 * At most `max` commands in any `windowMs` for one admin (planner, 2026-09-30: "about 5 a second, to stop a stuck
 * key flooding it"). Kept in memory: a restart of the api forgets it, which is fine for a guard like this.
 */
export class RateLimit {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly max = 5, private readonly windowMs = 1000, private readonly now: () => number = Date.now) {}

  /** True, and counted, when this caller may send one more now. */
  take(who: string): boolean {
    const t = this.now();
    const recent = (this.sent.get(who) ?? []).filter((at) => t - at < this.windowMs);
    if (recent.length >= this.max) {
      this.sent.set(who, recent);
      return false;
    }
    recent.push(t);
    this.sent.set(who, recent);
    return true;
  }
}

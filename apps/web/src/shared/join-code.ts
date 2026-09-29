// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/14 "The join code": each player held in the white room gets a short code. It is in the chat link
// (/link/<code>) and on screen ("go to deepslate.dsw.test/join and enter ABC-123"), so it can also be typed in
// on a phone. Pure, so it is tested.

/** No 0/O, 1/I: nothing that reads as something else, on a screen or spoken over voice chat. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 30 * 60_000;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A new code from `random(n)`, a whole number below n (crypto's randomInt). */
export function makeCode(random: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

/** As it is shown: "ABC-123". */
export const showCode = (code: string) => (code.length === CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

/** What somebody typed, as it is looked up: "abc 123", "ABC-123" and " abc123 " are all "ABC123". */
export const readCode = (raw: string) => raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

/** A code that can still be used by this member: not expired, and not used by somebody else. */
export function codeUsable(link: { expiresAt: Date; usedById: string | null } | null, userId: string, now: Date): boolean {
  return Boolean(link && link.expiresAt.getTime() > now.getTime() && (!link.usedById || link.usedById === userId));
}

/**
 * Wrong codes, counted per member and for everyone together, over a sliding window. Only misses count, so somebody
 * who types their code right is never slowed down; somebody guessing gets `perKey` tries, and all the accounts in
 * the group together get `overall`. With 32^6 codes that makes guessing a live one hopeless.
 */
export class GuessLimiter {
  private misses = new Map<string, number[]>();
  private all: number[] = [];
  constructor(private readonly perKey = 5, private readonly overall = 30, private readonly windowMs = 15 * 60_000) {}

  private recent(list: number[], now: number) {
    return list.filter((t) => t > now - this.windowMs);
  }

  /** Null when they may try; otherwise the milliseconds until they may. */
  wait(key: string, now: number = Date.now()): number | null {
    const mine = this.recent(this.misses.get(key) ?? [], now);
    this.misses.set(key, mine);
    this.all = this.recent(this.all, now);
    const until = (list: number[], limit: number) => (list.length >= limit ? list[list.length - limit]! + this.windowMs - now : 0);
    const ms = Math.max(until(mine, this.perKey), until(this.all, this.overall));
    return ms > 0 ? ms : null;
  }

  miss(key: string, now: number = Date.now()) {
    this.misses.set(key, [...this.recent(this.misses.get(key) ?? [], now), now]);
    this.all = [...this.recent(this.all, now), now];
    if (this.misses.size > 10_000) this.misses.clear(); // crude memory guard, as in rate-limit.ts
  }
}

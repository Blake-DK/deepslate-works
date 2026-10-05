// Build writes dist/, sync reads it: one of them at a time. The hold names its caller and when it began, so a second
// caller is told who has it (2026-10-03: two VPS sessions built and synced at once, and the log could not tell them apart).

export type Hold = { what: "build" | "sync"; by: string; since: Date };

const at = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;

export function busyMessage(h: Hold): string {
  return `a ${h.what} is already running, held by ${h.by} since ${at(h.since)}`;
}

export class OneAtATime {
  private hold: Hold | null = null;

  /** Takes the hold, or says who has it. `token`: this hold, to give back to `release`. */
  take(what: Hold["what"], by: string | null | undefined, now = new Date()): { ok: true; token: Hold } | { ok: false; message: string } {
    if (this.hold) return { ok: false, message: busyMessage(this.hold) };
    this.hold = { what, by: by || "an unnamed caller", since: now };
    return { ok: true, token: this.hold };
  }

  /**
   * With the token `take` gave: lets go only when that hold is still the one held. A build's stream that closes
   * late must not let go of what a later run has taken (docs/35 R-34). Without a token: lets go, whoever holds.
   */
  release(token?: Hold): void {
    if (token === undefined || this.hold === token) this.hold = null;
  }

  get current(): Hold | null {
    return this.hold;
  }
}

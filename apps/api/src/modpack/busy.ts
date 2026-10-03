// Build writes dist/, sync reads it: one of them at a time. The hold names its caller and when it began, so a second
// caller is told who has it (2026-10-03: two VPS sessions built and synced at once, and the log could not tell them apart).

export type Hold = { what: "build" | "sync"; by: string; since: Date };

const at = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;

export function busyMessage(h: Hold): string {
  return `a ${h.what} is already running, held by ${h.by} since ${at(h.since)}`;
}

export class OneAtATime {
  private hold: Hold | null = null;

  /** Takes the hold, or says who has it. */
  take(what: Hold["what"], by: string | null | undefined, now = new Date()): { ok: true } | { ok: false; message: string } {
    if (this.hold) return { ok: false, message: busyMessage(this.hold) };
    this.hold = { what, by: by || "an unnamed caller", since: now };
    return { ok: true };
  }

  release(): void {
    this.hold = null;
  }

  get current(): Hold | null {
    return this.hold;
  }
}

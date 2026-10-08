// docs/42 §7.1: the test clock. A season runs on dates (a trial opens on a Friday, the finale at 20:00 on a Saturday),
// and on the test server Alex says "pretend it is" a date and an hour; the clock runs on from there. Everything in api
// that asks the time for a season asks `now()` here, and this is the only place the pretend time lives (it is kept in
// the Setting row "test.clock" so that a restart of api keeps it, and so that web-test shows the same time). The door,
// sessions, audit rows and logs never ask it: they keep the real time.
//
// Off (TEST_MODE unset, the live api): `now()` is the real time and `shift()` changes nothing, whatever is stored.

export const CLOCK_KEY = "test.clock";

/** What is stored: the pretend instant and the real instant it was set at. The difference is the clock's offset. */
export type StoredClock = { pretend: string; setAt: string };
export type ClockView = { on: boolean; pretending: boolean; now: string; pretendSince: StoredClock | null };

export type ClockStore = {
  load: () => Promise<unknown>;
  save: (v: StoredClock | null) => Promise<void>;
};

/** A stored clock as it was written, or null for nothing or anything that does not read. */
export function readStored(v: unknown): StoredClock | null {
  if (!v || typeof v !== "object") return null;
  const { pretend, setAt } = v as { pretend?: unknown; setAt?: unknown };
  if (typeof pretend !== "string" || typeof setAt !== "string") return null;
  return Number.isFinite(Date.parse(pretend)) && Number.isFinite(Date.parse(setAt)) ? { pretend, setAt } : null;
}

/** The offset a stored clock means, in ms; 0 for none. */
export const offsetOf = (v: unknown): number => {
  const s = readStored(v);
  return s ? Date.parse(s.pretend) - Date.parse(s.setAt) : 0;
};

export class SeasonClock {
  private offset = 0;
  private stored: StoredClock | null = null;

  constructor(
    /** TEST_MODE: without it the clock is the real time, always. */
    readonly on: boolean,
    private readonly store: ClockStore | null = null,
    private readonly real: () => number = Date.now,
  ) {}

  /** The time for a season: the real time on live, the pretend time on test while one is set. */
  now = (): Date => new Date(this.real() + (this.on ? this.offset : 0));

  /** A real instant (the time the game wrote in a player's file) on the season's clock. */
  shift = (d: Date): Date => (this.on && this.offset !== 0 ? new Date(d.getTime() + this.offset) : d);

  get pretending(): boolean {
    return this.on && this.stored !== null;
  }

  /** Reads what is stored; at api's start. */
  async load(): Promise<void> {
    if (!this.on || !this.store) return;
    this.stored = readStored(await this.store.load().catch(() => null));
    this.offset = offsetOf(this.stored);
  }

  /** "Pretend it is" this instant; the clock runs on from it. */
  async set(pretend: Date): Promise<void> {
    if (!this.on) throw new Error("the test clock is for the test server only");
    const setAt = new Date(this.real());
    const next: StoredClock = { pretend: pretend.toISOString(), setAt: setAt.toISOString() };
    await this.store?.save(next);
    this.stored = next;
    this.offset = pretend.getTime() - setAt.getTime();
  }

  /** "Back to the real time". */
  async clear(): Promise<void> {
    if (!this.on) return;
    await this.store?.save(null);
    this.stored = null;
    this.offset = 0;
  }

  view(): ClockView {
    return { on: this.on, pretending: this.pretending, now: this.now().toISOString(), pretendSince: this.on ? this.stored : null };
  }
}

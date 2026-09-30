/** The instant as a `datetime-local` value in Europe/London wall-clock time ("" for none). */
export function dateToUkLocal(d: Date | null | undefined): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

/** "2 Oct, 05:20" in UK time. */
export function ukShort(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** Interprets a `datetime-local` string ("2026-10-04T19:00") as Europe/London wall-clock time and returns the instant. */
export function ukLocalToDate(local: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asUtc = new Date(`${local}:00Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const londonAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offsetMs = londonAsUtc - asUtc.getTime(); // how far London is ahead of UTC at that instant (0 or 1 h)
  return new Date(asUtc.getTime() - offsetMs);
}

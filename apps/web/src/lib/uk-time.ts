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

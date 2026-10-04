// The admin's lists: which rows are shown. Pure, so it is tested.

export const SHOW = { all: "Everyone", early: "Early access", rest: "Without", outdated: "Outdated installer", outside: "Outside Discord" } as const;
export type Show = keyof typeof SHOW;

/** `installerOutdated`: their latest run came from an installer older than the one the site hands out now. */
type MemberLike = { displayName: string; mcUsername: string | null; earlyAccess: boolean; installerOutdated?: boolean; outsideAuth?: boolean };

const KEEP: Record<Show, (u: MemberLike) => boolean> = {
  all: () => true,
  early: (u) => u.earlyAccess,
  rest: (u) => !u.earlyAccess,
  outdated: (u) => Boolean(u.installerOutdated),
  outside: (u) => Boolean(u.outsideAuth), // came in by an invite: the Discord server rule is not applied
};

/** Filter by early access (or by an outdated installer), then by what was typed: part of the Discord name or of the Minecraft name, any case. */
export function memberRows<T extends MemberLike>(all: T[], show: string | undefined, q: string | undefined): { rows: T[]; only: Show; query: string; count: Record<Show, number> } {
  const only: Show = show && Object.hasOwn(SHOW, show) ? (show as Show) : "all";
  const query = (q ?? "").trim().slice(0, 40);
  const needle = query.toLowerCase();
  const found = needle ? all.filter((u) => u.displayName.toLowerCase().includes(needle) || (u.mcUsername ?? "").toLowerCase().includes(needle)) : all;
  const count = Object.fromEntries((Object.keys(SHOW) as Show[]).map((k) => [k, found.filter(KEEP[k]).length])) as Record<Show, number>;
  return { rows: found.filter(KEEP[only]), only, query, count };
}

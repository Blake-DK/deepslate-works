// The admin's lists: which rows are shown. Pure, so it is tested.

export const SHOW = { all: "Everyone", early: "Early access", rest: "Without" } as const;
export type Show = keyof typeof SHOW;

type MemberLike = { displayName: string; mcUsername: string | null; earlyAccess: boolean };

/** Filter by early access, then by what was typed: part of the Discord name or of the Minecraft name, any case. */
export function memberRows<T extends MemberLike>(all: T[], show: string | undefined, q: string | undefined): { rows: T[]; only: Show; query: string; count: Record<Show, number> } {
  const only: Show = show === "early" || show === "rest" ? show : "all";
  const query = (q ?? "").trim().slice(0, 40);
  const needle = query.toLowerCase();
  const found = needle ? all.filter((u) => u.displayName.toLowerCase().includes(needle) || (u.mcUsername ?? "").toLowerCase().includes(needle)) : all;
  const count = { all: found.length, early: found.filter((u) => u.earlyAccess).length, rest: found.filter((u) => !u.earlyAccess).length };
  return { rows: found.filter((u) => only === "all" || (only === "early" ? u.earlyAccess : !u.earlyAccess)), only, query, count };
}

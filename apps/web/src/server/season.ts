import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { ukDayTime } from "@/lib/uk-time";
import { seasonGuide } from "@/lib/season-guide";
import { goalProgress, scoreboard, seasonCurrent, seasonFileSchema, seasonIndexFileSchema, seasonLine, type Clear, type ClearKind, type SeasonCurrent, type SeasonFile, type SeasonResult, type SeasonState } from "@/shared/season";

// docs/34 §5 (W1.3): what the site shows of a season. The content is the season's file in the repo's modpack/
// folder (mounted into web); whether it is running, and who has done what, is the database (api records it).
// A season the portal has no row for is not shown at all: Admin → Seasons makes the row (W1.4).

const DIR = path.join(process.env.MODPACK_DIR ?? path.resolve(process.cwd(), "..", "..", "modpack"), "seasons");
const STATES: readonly string[] = ["upcoming", "running", "ended"];

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(DIR, file), "utf8")) as unknown;
}

async function seasonFile(id: string): Promise<SeasonFile | null> {
  if (!/^[a-z0-9_]{1,32}$/.test(id)) return null;
  try {
    const parsed = seasonFileSchema.safeParse(await json(`${id}.json`));
    return parsed.success && parsed.data.id === id ? parsed.data : null;
  } catch {
    return null;
  }
}

async function currentFile(): Promise<SeasonFile | null> {
  try {
    const index = seasonIndexFileSchema.safeParse(await json("index.json"));
    return index.success && index.data.current ? await seasonFile(index.data.current) : null;
  } catch {
    return null;
  }
}

const stateOf = (s: string): SeasonState => (STATES.includes(s) ? (s as SeasonState) : "upcoming");

/** The current season in a few words, for Home, the nav and the app. `{ state: "none" }` when there is none to show. */
export async function getSeasonCurrent(now = new Date()): Promise<SeasonCurrent> {
  const file = await currentFile();
  if (!file) return { state: "none" };
  const row = await db.season.findUnique({ where: { id: file.id }, select: { state: true } }).catch(() => null);
  return seasonCurrent(file, row ? stateOf(row.state) : null, now);
}

/** The guide's Season section (Markdown), from the current season's file; null until a season is announced. */
export async function getSeasonGuide(): Promise<string | null> {
  const file = await currentFile();
  if (!file) return null;
  const row = await db.season.findUnique({ where: { id: file.id }, select: { state: true } }).catch(() => null);
  return row ? seasonGuide(file, stateOf(row.state), (iso) => ukDayTime(new Date(iso))) : null;
}

/** The one line Home and the app's banner show; null when there is no season to speak of. */
export const lineFor = (c: SeasonCurrent) => seasonLine(c, (iso) => ukDayTime(new Date(iso)));

export type LadderEntry = {
  kind: ClearKind; id: string; title: string; tier: number | null; points: number; where: string; hint: string;
  open: boolean; opensAt: Date;
  /** Who has done it, the first ones first. */
  by: Array<{ mcUuid: string; mcName: string; first: boolean; early: boolean; at: Date }>;
};

export type SeasonPage = {
  file: SeasonFile; state: SeasonState; current: SeasonCurrent;
  bosses: LadderEntry[]; trials: LadderEntry[];
  board: ReturnType<typeof scoreboard>; goal: ReturnType<typeof goalProgress>;
  result: SeasonResult | null;
};

/** Everything the Season page shows of the current season; null when there is none. */
export async function getSeasonPage(now = new Date()): Promise<SeasonPage | null> {
  const file = await currentFile();
  if (!file) return null;
  const row = await db.season.findUnique({ where: { id: file.id }, select: { state: true, resultJson: true } }).catch(() => null);
  if (!row) return null;
  const state = stateOf(row.state);
  const rows = await db.seasonClear.findMany({ where: { seasonId: file.id }, orderBy: { at: "asc" }, select: { kind: true, itemId: true, mcUuid: true, mcName: true, at: true, first: true, early: true } });
  const clears: Clear[] = rows.map((r) => ({ ...r, kind: (r.kind === "trial" ? "trial" : "boss") as ClearKind }));
  const entry = (kind: ClearKind, x: { id: string; title: string; points: number; hint: string; opensAt?: string; tier?: number; where?: string }): LadderEntry => {
    const opens = new Date(x.opensAt ?? file.startsAt);
    return {
      kind, id: x.id, title: x.title, tier: x.tier ?? null, points: x.points, where: x.where ?? "", hint: x.hint,
      open: opens <= now, opensAt: opens,
      by: clears.filter((c) => c.kind === kind && c.itemId === x.id).sort((a, b) => Number(b.first) - Number(a.first) || a.at.getTime() - b.at.getTime()),
    };
  };
  return {
    file, state, current: seasonCurrent(file, state, now),
    bosses: file.bosses.map((b) => entry("boss", b)).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.opensAt.getTime() - b.opensAt.getTime()),
    // this week's trial on top: the newest opened first, then what is still to come
    trials: file.trials.map((t) => entry("trial", t)).sort((a, b) => Number(b.open) - Number(a.open) || (a.open ? b.opensAt.getTime() - a.opensAt.getTime() : a.opensAt.getTime() - b.opensAt.getTime())),
    board: scoreboard(file, clears), goal: goalProgress(file, clears),
    result: state === "ended" && row.resultJson ? (row.resultJson as unknown as SeasonResult) : null,
  };
}

/** Seasons that have ended, newest first, with their frozen results: the Hall of fame. */
export async function getHallOfFame(): Promise<Array<{ id: string; name: string; endsAt: Date; result: SeasonResult }>> {
  const rows = await db.season.findMany({ where: { state: "ended" }, orderBy: { endsAt: "desc" }, select: { id: true, name: true, endsAt: true, resultJson: true } }).catch(() => []);
  return rows.flatMap((r) => (r.resultJson ? [{ id: r.id, name: r.name, endsAt: r.endsAt, result: r.resultJson as unknown as SeasonResult }] : []));
}

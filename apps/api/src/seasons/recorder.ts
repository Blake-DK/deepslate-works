import type { ConsoleEvent } from "../amp/console.js";
import type { NewEvent } from "../events/recorder.js";
import { findByTitle, goalMarks, goalProgress, names, opensAt, scoreboard, ukDay, type ClearKind, type SeasonFile } from "../shared/season.js";
import { advancementKey, doneAt } from "./advancements.js";
import { GROUP_MS, type ClearSource, type NewClear, type SeasonRow, type SeasonStore } from "./store.js";

// docs/20 §7, docs/34 §4: what the season remembers. The console says "<name> has completed the challenge [<title>]";
// the title is looked up in the current season's file, and a boss or a trial becomes a SeasonClear. Everything a
// season says (a boss fell, a trial opened, the goal's marks, a new leader) is one SEASON event, written here and
// only posted elsewhere (W1.5). Nothing is recorded unless the season's row says "running".

export type SeasonDeps = {
  file: () => Promise<SeasonFile | null>;
  store: SeasonStore;
  /** A player's UUID (dashed, lower case) by the name the console printed. */
  uuidOf: (name: string) => Promise<string | null>;
  addEvent: (e: NewEvent) => Promise<unknown>;
  /** A player's advancements file as data, for the safety net; null when it cannot be read. Absent: no safety net. */
  advancements?: () => Promise<((uuid: string) => Promise<unknown>) | null>;
  log: (o: unknown, m: string) => void;
  now?: () => Date;
  /** How long the first clear of a boss or trial waits for the rest of the group (docs/21 §6). */
  groupMs?: number;
  later?: (fn: () => void, ms: number) => void;
};

export { GROUP_MS };
/** A "has awoken" line comes once per boss in this long; the datapack takes the advancement back after as long. */
const WAKE_QUIET_MS = 15 * 60_000;
/** Something that opened longer ago than this is marked as said without saying it (api was off, or the season was started late). */
const STALE_MS = 24 * 3_600_000;
/** "Ends tomorrow at 19:00" is only true for so long, and "tonight at 20:00" only until the finale begins. */
const DAY_TO_GO_LATE_MS = 6 * 3_600_000;
const FINALE_LATE_MS = 3_600_000;
const LEADER_QUIET_MS = 24 * 3_600_000;
const WEEK_MS = 7 * 86_400_000;

/** "20:00", UK time. */
const ukClock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" });

type Pending = { kind: ClearKind; itemId: string; title: string; clears: NewClear[] };

export class SeasonRecorder {
  private chain: Promise<void> = Promise.resolve();
  private pending = new Map<string, Pending>();
  private woke = new Map<string, number>();
  private readonly now: () => Date;
  private readonly later: (fn: () => void, ms: number) => void;

  constructor(private readonly d: SeasonDeps) {
    this.now = d.now ?? (() => new Date());
    this.later = d.later ?? ((fn, ms) => void setTimeout(fn, ms).unref());
  }

  onConsole = (e: ConsoleEvent, info?: { replay: boolean }) => {
    // old lines, read again after a restart of api: what they said is found by the safety net, with the game's own time
    if (info?.replay || e.type !== "advancement") return;
    const at = this.now();
    this.enqueue(() => this.advancement(e.name, e.title, at));
  };

  /** Resolves when everything queued so far has been written. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(fn).catch((err) => this.d.log({ err: String(err) }, "season recorder failed"));
  }

  /** The current season's file and row, when it is running; else null. */
  private async running(): Promise<{ file: SeasonFile; row: SeasonRow } | null> {
    const file = await this.d.file();
    if (!file) return null;
    const row = await this.d.store.season(file.id);
    return row?.state === "running" ? { file, row } : null;
  }

  private event(file: SeasonFile, at: Date, actor: string | null, message: string, meta: Record<string, unknown>) {
    return this.d.addEvent({ at, kind: "SEASON", actor, message: message.slice(0, 500), meta: { season: file.id, ...meta } });
  }

  private async advancement(name: string, title: string, at: Date) {
    const file = await this.d.file();
    const hit = file ? findByTitle(file, title) : null;
    if (!file || !hit) return;
    if (!(await this.running())) return;
    if (hit.kind === "wake") {
      const last = this.woke.get(hit.id) ?? 0;
      if (at.getTime() - last < WAKE_QUIET_MS) return;
      this.woke.set(hit.id, at.getTime());
      await this.event(file, at, await this.d.uuidOf(name), `${hit.title} has awoken`, { what: "wake", id: hit.id, title: hit.title, by: name });
      return;
    }
    const uuid = await this.d.uuidOf(name);
    if (!uuid) {
      this.d.log({ name, title }, "season: no UUID for this name; the clear is left to the safety net");
      return;
    }
    const item = hit.kind === "boss" ? file.bosses.find((b) => b.id === hit.id) : file.trials.find((t) => t.id === hit.id);
    const clear: NewClear = { kind: hit.kind, itemId: hit.id, mcUuid: uuid, mcName: name, userId: await this.d.store.userIdByUuid(uuid), at, early: item ? at < opensAt(file, item) : false, source: "console" };
    const key = `${hit.kind}:${hit.id}`;
    const waiting = this.pending.get(key);
    if (waiting) {
      waiting.clears.push(clear);
      return;
    }
    // the first of a group: the others' lines follow within a tick or two, and one event names them all
    this.pending.set(key, { kind: hit.kind, itemId: hit.id, title: hit.title, clears: [clear] });
    this.later(() => this.enqueue(() => this.flush(key)), this.d.groupMs ?? GROUP_MS);
  }

  private async flush(key: string) {
    const batch = this.pending.get(key);
    this.pending.delete(key);
    if (!batch) return;
    const live = await this.running();
    if (!live) {
      this.d.log({ key, names: batch.clears.map((c) => c.mcName) }, "season: a group's clears were dropped, no season is running");
      return;
    }
    await this.write(live.file, batch, "console");
    await this.after(live.file);
  }

  /**
   * Before End freezes the result: every group still waiting out its five seconds is written now, and the safety
   * net looks at the files once more. Never rejects (the queue logs what fails).
   */
  async settle(): Promise<void> {
    await this.chain; // console lines still queued become waiting groups first
    for (const key of [...this.pending.keys()]) this.enqueue(() => this.flush(key));
    await this.fromFiles();
  }

  /**
   * Stores one boss's or trial's clears and says so in one event: two when some of them were first on the server
   * and some came after (the files can give both at once). Returns how many were new.
   */
  private async write(file: SeasonFile, batch: Pending, source: ClearSource): Promise<number> {
    const { added } = await this.d.store.addClears(file.id, batch.clears);
    for (const first of [true, false]) {
      const part = added.filter((c) => c.first === first);
      if (part.length === 0) continue;
      const who = names(part.map((c) => c.mcName));
      const early = part.every((c) => c.early) ? " (found early)" : "";
      const message = batch.kind === "boss"
        ? first ? `${batch.title} has fallen for the first time, to ${who}${early}` : `${who} defeated ${batch.title}${early}`
        : first ? `${who} ${part.length === 1 ? "is" : "are"} the first to finish the trial ${batch.title}${early}` : `${who} finished the trial ${batch.title}${early}`;
      const at = new Date(Math.max(...part.map((c) => c.at.getTime())));
      await this.event(file, at, part[0]!.mcUuid, message, { what: batch.kind, id: batch.itemId, title: batch.title, names: part.map((c) => c.mcName), uuids: part.map((c) => c.mcUuid), first, early: early !== "", source });
    }
    return added.length;
  }

  /** After new clears: the goal's quarter marks, and a new leader (once a day at most). */
  private async after(file: SeasonFile) {
    const at = this.now();
    const clears = await this.d.store.clears(file.id);
    const goal = goalProgress(file, clears);
    if (goal) {
      let top = 0;
      for (const m of goalMarks(goal.percent)) if (await this.d.store.mark(file.id, `goal:${m}`)) top = m;
      if (top === 100) await this.event(file, at, null, `The season's goal is reached: ${goal.title}`, { what: "goal", percent: 100, count: goal.count, target: goal.target });
      else if (top > 0) await this.event(file, at, null, `The season's goal is at ${top}%: ${goal.count} of ${goal.target} (${goal.title})`, { what: "goal", percent: top, count: goal.count, target: goal.target });
    }
    const board = scoreboard(file, clears);
    const lead = board[0];
    const second = board[1];
    const row = await this.d.store.season(file.id);
    if (!lead || !row || (second && second.points === lead.points)) return; // nobody, or level at the top: no leader to name
    if (row.marks.leader === lead.mcUuid) return;
    if (row.marks.leaderAt && at.getTime() - Date.parse(row.marks.leaderAt) < LEADER_QUIET_MS) return;
    await this.d.store.setLeader(file.id, lead.mcUuid, at);
    await this.event(file, at, lead.mcUuid, `${lead.mcName} leads the season with ${lead.points} points`, { what: "leader", name: lead.mcName, uuid: lead.mcUuid, points: lead.points });
  }

  /**
   * The clock, once a minute: a trial or a boss that has just opened, a week and a day to go, the finale an hour
   * before it (docs/21 §6). Each is said once (Season.marks), and not at all when its moment passed too long ago
   * for the line to be true still: a day for what opened, six hours and the same evening for "ends tomorrow", an
   * hour for "tonight at". The line is said before its mark is put, so one that could not be written is said at
   * the next minute and not lost.
   */
  tick(): Promise<void> {
    this.enqueue(async () => {
      const live = await this.running();
      if (!live) return;
      const { file } = live;
      const at = this.now();
      const t = at.getTime();
      const said = new Set(live.row.marks.done ?? []);
      const due = async (key: string, when: number, late: number, say: () => Promise<unknown>) => {
        if (when > t || said.has(key)) return;
        if (t - when < late) await say();
        await this.d.store.mark(file.id, key);
      };
      const ends = Date.parse(file.endsAt);
      // "tomorrow" stops being true at midnight in the UK, however few hours have passed
      const dayLate = ukDay(new Date(ends)) - ukDay(at) === 1 ? DAY_TO_GO_LATE_MS : 0;
      const start = Date.parse(file.startsAt);
      for (const x of file.trials) {
        await due(`trial:${x.id}`, Date.parse(x.opensAt), STALE_MS, () => this.event(file, at, null, `A new trial is open: ${x.title}${x.hint ? `. ${x.hint}` : ""}`, { what: "trial_open", id: x.id, title: x.title }));
      }
      for (const b of file.bosses) {
        if (!b.opensAt || Date.parse(b.opensAt) <= start) continue;
        await due(`boss:${b.id}`, Date.parse(b.opensAt), STALE_MS, () => this.event(file, at, null, `${b.title} joins the ladder${b.where ? `. ${b.where}` : ""}`, { what: "boss_open", id: b.id, title: b.title }));
      }
      await due("week_to_go", ends - WEEK_MS, STALE_MS, () => this.event(file, at, null, `A week to go in ${file.name}`, { what: "week_to_go" }));
      await due("day_to_go", ends - 86_400_000, dayLate, () => this.event(file, at, null, `${file.name} ends tomorrow at ${ukClock(new Date(ends))} UK`, { what: "day_to_go" }));
      if (file.finale) {
        const f = file.finale;
        await due("finale", Date.parse(f.at) - 3_600_000, FINALE_LATE_MS, () => this.event(file, at, null, `${f.title}: tonight at ${ukClock(new Date(f.at))} UK`, { what: "finale", title: f.title, boss: f.boss }));
      }
    });
    return this.chain;
  }

  /**
   * The safety net: every linked member's advancements file against the season's bosses and trials. What is done
   * there and has no row gets one, with the time the game wrote and `source: file`.
   */
  fromFiles(): Promise<void> {
    this.enqueue(async () => {
      const live = await this.running();
      const read = live && this.d.advancements ? await this.d.advancements() : null;
      if (!live || !read) return;
      const { file } = live;
      const start = Date.parse(file.startsAt);
      const revoked = new Set(live.row.marks.revoked ?? []); // an admin took these back: the game's file does not put them back
      const have = new Set((await this.d.store.clears(file.id)).map((c) => `${c.kind}:${c.itemId}:${c.mcUuid}`));
      const found = new Map<string, Pending>();
      const items: Array<{ kind: ClearKind; id: string; title: string; opens: Date }> = [
        ...file.bosses.map((b) => ({ kind: "boss" as const, id: b.id, title: b.title, opens: opensAt(file, b) })),
        ...file.trials.map((x) => ({ kind: "trial" as const, id: x.id, title: x.title, opens: opensAt(file, x) })),
      ];
      for (const m of await this.d.store.linked()) {
        if (items.every((i) => have.has(`${i.kind}:${i.id}:${m.mcUuid}`))) continue;
        const data = await read(m.mcUuid);
        if (!data) continue;
        for (const i of items) {
          if (have.has(`${i.kind}:${i.id}:${m.mcUuid}`)) continue;
          const done = doneAt(data, advancementKey(file.id, i.kind, i.id));
          if (!done || done.getTime() < start) continue; // before the season: nothing is recorded
          if (revoked.has(`${i.kind}:${i.id}:${m.mcUuid}`)) continue;
          const key = `${i.kind}:${i.id}`;
          const batch = found.get(key) ?? { kind: i.kind, itemId: i.id, title: i.title, clears: [] };
          batch.clears.push({ kind: i.kind, itemId: i.id, mcUuid: m.mcUuid, mcName: m.mcName, userId: m.userId, at: done, early: done < i.opens, source: "file" });
          found.set(key, batch);
        }
      }
      let added = 0;
      for (const batch of [...found.values()].sort((a, b) => a.clears[0]!.at.getTime() - b.clears[0]!.at.getTime())) added += await this.write(file, batch, "file");
      if (added > 0) {
        this.d.log({ season: file.id, added }, "season: clears found in the advancement files that the console had not given");
        await this.after(file);
      }
    });
    return this.chain;
  }
}

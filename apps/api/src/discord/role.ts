// The "Minecraft" role (planner, 2026-10-09): a Discord role on everyone who plays, so Alex can mention just them.
// Who should hold it: a member with a Discord id and a linked Minecraft account (linking is what lets them out of the
// entrance room). One reconciler does all of it: it reads each such member from Discord and adds or removes the role
// where it is wrong. It runs at start, once a day, and soon after a link or an unlink is written to the event log
// (whichever path wrote it: the door, the site, an admin), so nothing that links or unlinks needs to know about roles.
//
// Off unless DISCORD_PLAYER_ROLE_ID is set, and made only with the bot (wire.ts), which exists only on the api marked
// DISCORD_TALKS=1 (gate.ts): the test stack never adds or removes a role. A refusal never stops a link: it is logged,
// and said once on the admin channel with the fix, and again only if the reason changes.
import type { Rest } from "./rest.js";

export type RoleView =
  | { state: "off" }
  | { state: "on"; holders: number | null; lastRunAt: string | null; lastError: string | null };

/** A member the portal knows with a Discord account. Members who came in by an invite without Discord are never passed. */
export type RoleUser = { id: string; discordId: string; name: string; linked: boolean };

export type RoleDeps = {
  rest: { call(method: "GET" | "PUT" | "DELETE", path: string): Promise<Rest> };
  guild: string;
  role: string;
  users(): Promise<RoleUser[]>;
  /** LINK and REVOKE events after `after` (the event log's id), oldest first, with what their params say. */
  linkEvents(after: bigint): Promise<Array<{ id: bigint; discordId: string | null }>>;
  newestEventId(): Promise<bigint>;
  /** One line in the event log for every add and remove. */
  audit(entry: { action: "discord.roleAdd" | "discord.roleRemove"; userId: string | null; name: string; ok: boolean; error?: string }): Promise<void>;
  /** A problem for the admin channel (an ERROR event: the feed posts it there). Called once per distinct reason. */
  raise(message: string): Promise<void>;
  log: (o: unknown, m: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const DAY_MS = 24 * 60 * 60_000;
const POLL_MS = 30_000;
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_ROLE = 10011;
const MISSING_PERMISSIONS = 50013;
const MISSING_ACCESS = 50001;

/** What went wrong, in words for the admin channel, with the fix. */
export function roleProblem(r: Extract<Rest, { ok: false }>): string {
  if (r.code === UNKNOWN_ROLE) return "The Minecraft role could not be found in the Discord server. Check DISCORD_PLAYER_ROLE_ID in deploy/.env is the role's id (right-click the role, Copy Role ID), then deploy again.";
  if (r.code === MISSING_PERMISSIONS || r.code === MISSING_ACCESS || r.status === 403)
    return "The bot is not allowed to give or take the Minecraft role. In Discord: Server Settings, Roles, drag the bot's role above Minecraft and give the bot Manage Roles. Players keep playing; the role catches up on the next run.";
  return `The Minecraft role could not be changed: ${r.error}. Players keep playing; it is tried again later.`;
}

export class RoleSync {
  private holders: number | null = null;
  private lastRunAt: Date | null = null;
  private lastError: string | null = null;
  private raised: string | null = null;
  private cursor: bigint | null = null;
  private running = false;
  private pending = new Set<string>(); // Discord ids of members removed from the portal: their role goes too
  private timers: NodeJS.Timeout[] = [];
  private readonly now: () => Date;

  constructor(private readonly d: RoleDeps) {
    this.now = d.now ?? (() => new Date());
  }

  view(): RoleView {
    return { state: "on", holders: this.holders, lastRunAt: this.lastRunAt?.toISOString() ?? null, lastError: this.lastError };
  }

  start() {
    void this.run("start");
    this.timers.push(setInterval(() => void this.run("daily"), DAY_MS));
    this.timers.push(setInterval(() => void this.poll(), POLL_MS));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Every 30 s: a link or an unlink since the last look means a run now. */
  async poll(): Promise<void> {
    try {
      if (this.cursor === null) {
        this.cursor = await this.d.newestEventId();
        return;
      }
      const events = await this.d.linkEvents(this.cursor);
      if (!events.length) return;
      this.cursor = events[events.length - 1]!.id;
      for (const e of events) if (e.discordId) this.pending.add(e.discordId);
      await this.run("link");
    } catch (err) {
      this.d.log({ err: String(err) }, "discord role: could not read the event log");
    }
  }

  /** One pass over every member with a Discord id. Safe to run any number of times: it only changes what is wrong. */
  async run(why: string): Promise<{ added: number; removed: number; holders: number; problems: number }> {
    const out = { added: 0, removed: 0, holders: 0, problems: 0 };
    if (this.running) return out;
    this.running = true;
    let problem: string | null = null;
    try {
      if (this.cursor === null) this.cursor = await this.d.newestEventId().catch(() => null);
      const users = await this.d.users();
      const known = new Set(users.map((u) => u.discordId));
      const removed: RoleUser[] = [...this.pending].filter((id) => !known.has(id)).map((id) => ({ id: "", discordId: id, name: "a removed member", linked: false }));
      this.pending.clear();
      for (const u of [...users, ...removed]) {
        const m = await this.d.rest.call("GET", `/guilds/${this.d.guild}/members/${u.discordId}`);
        if (!m.ok) {
          if (m.code === UNKNOWN_MEMBER || m.status === 404) continue; // not in the server (left, never joined): nothing to hold
          problem ??= roleProblem(m);
          out.problems++;
          continue;
        }
        const has = ((m.data as { roles?: string[] } | null)?.roles ?? []).includes(this.d.role);
        if (has === u.linked) {
          if (has) out.holders++;
          continue;
        }
        const r = await this.d.rest.call(u.linked ? "PUT" : "DELETE", `/guilds/${this.d.guild}/members/${u.discordId}/roles/${this.d.role}`);
        await this.d.audit({ action: u.linked ? "discord.roleAdd" : "discord.roleRemove", userId: u.id || null, name: u.name, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
        if (r.ok) {
          if (u.linked) { out.added++; out.holders++; } else out.removed++;
        } else {
          if (u.linked === false) out.holders++; // still holds it
          problem ??= roleProblem(r);
          out.problems++;
        }
      }
      this.holders = out.holders;
      this.lastRunAt = this.now();
      this.lastError = problem;
      if (problem && problem !== this.raised) {
        this.raised = problem;
        await this.d.raise(problem).catch((err) => this.d.log({ err: String(err) }, "discord role: could not raise the problem"));
      }
      if (!problem) this.raised = null; // a clean run: the next refusal is told again
      if (out.added || out.removed || problem) this.d.log({ why, ...out, problem }, "discord role: run");
    } catch (err) {
      this.lastError = `The Minecraft role check did not finish: ${String(err).slice(0, 160)}`;
      this.d.log({ err: String(err) }, "discord role: run failed");
    } finally {
      this.running = false;
    }
    return out;
  }
}

import { describe, expect, it } from "vitest";
import { RoleSync, type RoleDeps, type RoleUser } from "../src/discord/role.js";
import type { Rest } from "../src/discord/rest.js";
import { makeRoleSync } from "../src/discord/wire.js";
import type { Env } from "../src/env.js";

// The Minecraft role (planner, 2026-10-09): everyone who has linked their game holds it; nobody else does.

const GUILD = "123456789012345678";
const ROLE = "223456789012345678";

type Call = { method: string; path: string };

/** A fake Discord: members by id with their roles; `refuse` answers every role change with an error. */
function discord(members: Record<string, string[]>, refuse: { r: Rest | null }) {
  const calls: Call[] = [];
  const call = async (method: "GET" | "PUT" | "DELETE", path: string): Promise<Rest> => {
    calls.push({ method, path });
    const m = /\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(path);
    const id = m?.[1] ?? "";
    if (!(id in members)) return { ok: false, status: 404, code: 10007, error: "Discord answered 404: Unknown Member" };
    if (method === "GET") return { ok: true, data: { roles: [...members[id]!] } };
    if (refuse.r) return refuse.r;
    if (method === "PUT") members[id] = [...new Set([...members[id]!, m![2]!])];
    else members[id] = members[id]!.filter((r) => r !== m![2]);
    return { ok: true, data: null };
  };
  return { calls, members, rest: { call } };
}

function setup(users: RoleUser[], members: Record<string, string[]>, refuse: Rest | null = null) {
  const gate = { r: refuse };
  const d = discord(members, gate);
  const audits: Array<{ action: string; name: string; ok: boolean }> = [];
  const raised: string[] = [];
  let events: Array<{ id: bigint; discordId: string | null }> = [];
  const deps: RoleDeps = {
    rest: d.rest, guild: GUILD, role: ROLE,
    users: async () => users,
    linkEvents: async (after) => events.filter((e) => e.id > after),
    newestEventId: async () => events.reduce((m, e) => (e.id > m ? e.id : m), 0n),
    audit: async (e) => { audits.push({ action: e.action, name: e.name, ok: e.ok }); },
    raise: async (m) => { raised.push(m); },
    log: () => {},
  };
  return { sync: new RoleSync(deps), d, audits, raised, users, gate, setEvents: (e: typeof events) => { events = e; } };
}

const u = (id: string, discordId: string, linked: boolean): RoleUser => ({ id, discordId, name: id, linked });
const changes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("the Minecraft role (planner, 2026-10-09)", () => {
  it("a member who links gets the role, and it is in the event log", async () => {
    const t = setup([u("Bramble09", "100000000000000001", true)], { "100000000000000001": [] });
    const r = await t.sync.run("link");
    expect(r).toMatchObject({ added: 1, removed: 0, holders: 1 });
    expect(t.d.members["100000000000000001"]).toContain(ROLE);
    expect(changes(t.d.calls)).toEqual([{ method: "PUT", path: `/guilds/${GUILD}/members/100000000000000001/roles/${ROLE}` }]);
    expect(t.audits).toEqual([{ action: "discord.roleAdd", name: "Bramble09", ok: true }]);
  });

  it("a member who is unlinked loses it", async () => {
    const t = setup([u("m1_owl", "100000000000000002", false)], { "100000000000000002": [ROLE, "999"] });
    expect(await t.sync.run("unlink")).toMatchObject({ added: 0, removed: 1, holders: 0 });
    expect(t.d.members["100000000000000002"]).toEqual(["999"]); // other roles kept
    expect(t.audits).toEqual([{ action: "discord.roleRemove", name: "m1_owl", ok: true }]);
  });

  it("the backfill adds and removes where it is wrong, leaves the rest, and a second run changes nothing", async () => {
    const t = setup(
      [u("Bramble09", "100000000000000001", true), u("m1_owl", "100000000000000002", false), u("samoyedx", "100000000000000003", true), u("KaneFinch", "100000000000000004", false)],
      { "100000000000000001": [], "100000000000000002": [ROLE], "100000000000000003": [ROLE], "100000000000000004": [] },
    );
    expect(await t.sync.run("start")).toMatchObject({ added: 1, removed: 1, holders: 2, problems: 0 });
    t.d.calls.length = 0;
    expect(await t.sync.run("daily")).toMatchObject({ added: 0, removed: 0, holders: 2 });
    expect(changes(t.d.calls)).toEqual([]);
    expect(t.sync.view()).toMatchObject({ state: "on", holders: 2, lastError: null });
  });

  it("a member who is not in the Discord server is skipped quietly", async () => {
    const t = setup([u("Rowan", "100000000000000005", true)], {});
    expect(await t.sync.run("start")).toMatchObject({ added: 0, problems: 0 });
    expect(changes(t.d.calls)).toEqual([]);
    expect(t.raised).toEqual([]);
  });

  it("a member without Discord (an invite) is never asked about: users() only lists members with a Discord id", async () => {
    const t = setup([], { "100000000000000001": [] });
    await t.sync.run("start");
    expect(t.d.calls).toEqual([]);
  });

  it("a member removed from the portal loses the role after the remove is in the event log", async () => {
    const t = setup([], { "100000000000000006": [ROLE] });
    await t.sync.poll(); // first look: from now on
    t.setEvents([{ id: 5n, discordId: "100000000000000006" }]);
    await t.sync.poll();
    expect(t.d.members["100000000000000006"]).toEqual([]);
    expect(t.audits).toEqual([{ action: "discord.roleRemove", name: "a removed member", ok: true }]);
  });

  it("a refusal is logged, raised once on the admin channel with the fix, and does not throw", async () => {
    const refuse: Rest = { ok: false, status: 403, code: 50013, error: "Discord answered 403: Missing Permissions" };
    const t = setup([u("Bramble09", "100000000000000001", true), u("owly", "100000000000000007", true)], { "100000000000000001": [], "100000000000000007": [] }, refuse);
    await t.sync.run("start");
    await t.sync.run("daily");
    await t.sync.run("link");
    expect(t.raised).toHaveLength(1);
    expect(t.raised[0]).toMatch(/drag the bot's role above Minecraft and give the bot Manage Roles/);
    expect(t.audits.filter((a) => !a.ok)).toHaveLength(6); // every attempt is in the event log
    expect(t.sync.view()).toMatchObject({ holders: 0, lastError: t.raised[0] });
  });

  it("is told again after a clean run, if it breaks again", async () => {
    const refuse: Rest = { ok: false, status: 403, code: 50013, error: "x" };
    const users = [u("Bramble09", "100000000000000001", true)];
    const t = setup(users, { "100000000000000001": [], "100000000000000008": [] }, refuse);
    await t.sync.run("start");
    t.gate.r = null;
    await t.sync.run("daily"); // fixed: the role is given, a clean run
    expect(t.sync.view()).toMatchObject({ holders: 1, lastError: null });
    t.gate.r = refuse;
    users.push(u("samoyedx", "100000000000000008", true));
    await t.sync.run("link");
    expect(t.raised).toHaveLength(2);
  });
});

describe("the role stays off where it must (docs/42a, planner 2026-10-09)", () => {
  const base = { DISCORD_BOT_TOKEN: "bot-token-for-tests", DISCORD_GUILD_ID: GUILD, DISCORD_PLAYER_ROLE_ID: ROLE, PORTAL_URL: "https://deepslate.dsw.test" };
  it("an api not marked DISCORD_TALKS=1 (the test stack) has no role sync at all, so it makes no role request", () => {
    expect(makeRoleSync({ ...base } as unknown as Env, () => {})).toBeNull();
  });
  it("the live api without a role id: off", () => {
    expect(makeRoleSync({ ...base, DISCORD_TALKS: "1", DISCORD_PLAYER_ROLE_ID: "" } as unknown as Env, () => {})).toBeNull();
  });
  it("the live api with a role id: on", () => {
    expect(makeRoleSync({ ...base, DISCORD_TALKS: "1" } as unknown as Env, () => {})?.view()).toMatchObject({ state: "on", holders: null });
  });
});

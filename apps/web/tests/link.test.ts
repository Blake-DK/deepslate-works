import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/31 PR D. B-06: looking at a code links nothing; only linkWithCode (reached from a POST) does. B-05: linking
// never writes the Discord-server flag, and somebody who has left the server is refused. B-16: an old code of one's
// own is not a wrong guess.

const state = vi.hoisted(() => ({
  codes: new Map<string, { code: string; mcUuid: string; mcUsername: string; expiresAt: Date; usedById: string | null }>(),
  users: [] as Array<{ id: string; mcUuid: string | null; displayName: string }>,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; params: Record<string, unknown>; result: string }>,
  released: [] as string[],
}));

vi.mock("@/server/db", () => {
  const tx = {
    user: { update: async ({ data }: { data: Record<string, unknown> }) => void state.updates.push(data) },
    linkCode: { update: async ({ where, data }: { where: { code: string }; data: { usedById: string } }) => { state.codes.get(where.code)!.usedById = data.usedById; } },
  };
  return {
    db: {
      linkCode: { findUnique: async ({ where }: { where: { code: string } }) => state.codes.get(where.code) ?? null },
      user: { findFirst: async ({ where }: { where: { mcUuid: string; NOT: { id: string } } }) => state.users.find((u) => u.mcUuid === where.mcUuid && u.id !== where.NOT.id) ?? null },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
});
vi.mock("@/server/events", () => ({ audit: async (a: { action: string; params: Record<string, unknown>; result: string }) => void state.audits.push(a) }));
vi.mock("@/server/api-client", () => ({ apiFetch: async (_p: string, o: { body: { uuid: string } }) => { state.released.push(o.body.uuid); return { released: true }; } }));

import { checkCode, guesses, linkWithCode } from "@/server/link";
import { holdsKey, publicHealth } from "@/lib/health";
import { parseBlocked } from "@/server/auth/blocked";
import { describeAction } from "@/shared/events";

const UUID = "9e2b7c41-0a5d-4f36-8c19-b4e07d2a6f53";
const soon = () => new Date(Date.now() + 20 * 60_000);
const member = (over: Partial<Parameters<typeof checkCode>[0]> = {}) => ({ id: "u1", role: "PLAYER" as const, mcUuid: null, mcUsername: null, verifiedAt: null, discordId: "111111111111111111", guildMember: true, ...over });
let n = 0;
const fresh = () => member({ id: `u${++n}` }); // the guess limiter is per member and lives for the whole file

beforeEach(() => {
  state.codes.clear();
  state.users = [];
  state.updates.length = 0;
  state.audits.length = 0;
  state.released.length = 0;
  state.codes.set("ABC234", { code: "ABC234", mcUuid: UUID, mcUsername: "stranger_mc", expiresAt: soon(), usedById: null });
});

describe("opening a link links nothing (B-06)", () => {
  it("the check names the Minecraft account and changes nothing", async () => {
    const r = await checkCode(fresh(), "ABC234", "link");
    expect(r).toEqual({ ok: true, code: "ABC234", mcUsername: "stranger_mc", mcUuid: UUID, already: false });
    expect(state.updates).toEqual([]);
    expect(state.released).toEqual([]);
    expect(state.codes.get("ABC234")?.usedById).toBeNull();
    expect(state.audits).toEqual([]);
  });

  it("the button links, uses the code up and asks api to let them out", async () => {
    const u = fresh();
    const out = await linkWithCode(u, "ABC234", "link");
    expect(out).toMatchObject({ tone: "success", title: "Linked as stranger_mc" });
    expect(state.updates).toHaveLength(1);
    expect(state.released).toEqual([UUID]);
    expect(state.codes.get("ABC234")?.usedById).toBe(u.id);
    expect(state.audits.at(-1)).toMatchObject({ action: "link.bind", result: "OK" });
    // the page shown after the button: the same code, now theirs, says "already" instead of asking again
    expect(await checkCode({ ...u, mcUuid: UUID, mcUsername: "stranger_mc" }, "ABC234", "link")).toMatchObject({ ok: true, already: true });
  });

  it("a code another member has used is run out for everyone else", async () => {
    state.codes.get("ABC234")!.usedById = "someone-else";
    const r = await checkCode(fresh(), "ABC234", "link");
    expect(r).toMatchObject({ ok: false, outcome: { title: "That code has run out" } });
  });

  it("a Minecraft account that belongs to another member is refused", async () => {
    state.users = [{ id: "other", mcUuid: UUID, displayName: "Rowan" }];
    expect(await checkCode(fresh(), "ABC234", "link")).toMatchObject({ ok: false, outcome: { title: "That Minecraft account belongs to someone else" } });
    expect(await linkWithCode(fresh(), "ABC234", "link")).toMatchObject({ tone: "error" });
    expect(state.updates).toEqual([]);
  });
});

describe("leaving the Discord server sticks (B-05)", () => {
  it("linking never writes the Discord-server flag", async () => {
    await linkWithCode(fresh(), "ABC234", "join");
    expect(state.updates[0]).not.toHaveProperty("guildMember");
    expect(Object.keys(state.updates[0]!).sort()).toEqual(["mcUsername", "mcUuid", "verifiedAt"]);
  });

  it("somebody who has left the server cannot link their way back in", async () => {
    const left = { ...fresh(), mcUuid: UUID, mcUsername: "stranger_mc", guildMember: false };
    expect(await linkWithCode(left, "ABC234", "link")).toMatchObject({ tone: "error", title: "Sign in with Discord again" });
    expect(state.updates).toEqual([]);
    expect(state.released).toEqual([]);
    expect(state.audits.at(-1)).toMatchObject({ action: "link.bind", result: "DENIED", params: { refused: "left_discord" } });
  });

  it("the member without Discord (email fallback) is not caught by that rule", async () => {
    expect(await linkWithCode({ ...fresh(), discordId: null, guildMember: false }, "ABC234", "link")).toMatchObject({ tone: "success" });
  });
});

describe("wrong guesses (B-16)", () => {
  it("only a code that does not exist counts; five old links of one's own lock nobody out", async () => {
    const u = fresh();
    state.codes.set("OLD234", { code: "OLD234", mcUuid: UUID, mcUsername: "stranger_mc", expiresAt: new Date(Date.now() - 60_000), usedById: null });
    for (let i = 0; i < 6; i++) expect(await checkCode(u, "OLD234", "link")).toMatchObject({ ok: false, outcome: { title: "That code has run out" } });
    expect(guesses.wait(u.id)).toBeNull();
    expect(await checkCode(u, "ABC234", "link")).toMatchObject({ ok: true });
  });

  it("five codes that do not exist do", async () => {
    const u = fresh();
    for (let i = 0; i < 5; i++) expect(await checkCode(u, `NOPE2${i}`, "join")).toMatchObject({ ok: false, outcome: { title: "That code isn't right" } });
    expect(await checkCode(u, "ABC234", "join")).toMatchObject({ ok: false, outcome: { title: "Too many wrong codes" } });
  });
});

describe("the small ones", () => {
  it("B-39: health for someone who is not an admin says yes or no, never what is wrong", () => {
    const full = { ok: true, db: true, api: { ok: false, tunnel: "down", amp: "unreachable", rsync: "no_key", discordBot: "refused" }, missingEnv: ["AUTH_SECRET"], discord: true, guildGate: true, pack: { server: "0.1.0+0d33a462", main: "0.1.0+d7521da9", same: false, unpushed: 2 } };
    const pub = publicHealth(full);
    expect(pub).toEqual({ ok: true, db: true, api: { ok: false }, watch: true, pack: { same: false } });
    expect(publicHealth({ ...full, api: { ok: true, watch: false } }).watch).toBe(false); // the health watch found something wrong
    expect(JSON.stringify(pub)).not.toMatch(/tunnel|rsync|AUTH_SECRET|0d33a462|unpushed/);
    expect(JSON.stringify(publicHealth({ ...full, api: { ok: true } }))).toContain('"api":{"ok":true}'); // what deploy.sh and a monitor look for
  });

  it("B-39: the detail on the host needs the service token as the key; a wrong, short or missing one gets nothing", () => {
    const key = "k".repeat(40);
    expect(holdsKey(key, key)).toBe(true);
    expect(holdsKey("k".repeat(39) + "x", key)).toBe(false);
    expect(holdsKey("k".repeat(41), key)).toBe(false);
    expect(holdsKey(null, key)).toBe(false);
    expect(holdsKey("", "")).toBe(false); // an unset token opens nothing
    expect(holdsKey("short", "short")).toBe(false);
  });

  it("B-37: the blocked list takes only Discord ids, and the event log says who was blocked", () => {
    expect(parseBlocked([{ discordId: "111111111111111111", name: "Rowan", at: "2026-10-04T12:00:00Z" }, { discordId: "not-an-id" }, "x", null])).toEqual([{ discordId: "111111111111111111", name: "Rowan", at: "2026-10-04T12:00:00Z" }]);
    expect(parseBlocked(null)).toEqual([]);
    expect(describeAction("user.remove", { role: "ADMIN", name: "Alex" }, { displayName: "Rowan", blocked: true })).toMatch(/removed Rowan from the group and blocked their Discord account/);
    expect(describeAction("user.remove", { role: "ADMIN", name: "Alex" }, { displayName: "Rowan" })).not.toMatch(/blocked/);
  });
});

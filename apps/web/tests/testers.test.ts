import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/57, testers: the live site's Tester switch. One click on or off, only for a linked member, every change audited
// as user.tester and told to the test server's api; the existing ways out (removed, blocked, unlinked, left Discord)
// turn it off; and the test server's list is put right whenever its fingerprint is not this site's.

type Row = { id: string; displayName: string; role: string; tester: boolean; testerAt: Date | null; mcUuid: string | null; mcUsername: string | null; verifiedAt: Date | null };
const st = vi.hoisted(() => ({
  rows: [] as Row[],
  audits: [] as Array<{ userId: string | null; action: string; params: Record<string, unknown> }>,
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  state: { testers: null as string | null } as Record<string, unknown>,
  reachable: true,
  configured: true,
}));

vi.mock("@/server/db", () => ({
  db: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => st.rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = st.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      findMany: async () => st.rows.filter((r) => r.tester && r.mcUuid && r.mcUsername && r.verifiedAt),
    },
  },
}));
vi.mock("@/server/events", () => ({ audit: async (a: { userId: string | null; action: string; params: Record<string, unknown> }) => { st.audits.push(a); } }));
vi.mock("@/server/test-app", () => ({ testAppConfigured: () => st.configured }));
vi.mock("@/server/api-client", () => ({
  testAppCall: async (path: string, init: { method?: string; body?: unknown } = {}) => {
    st.calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (!st.reachable) return null;
    if (path === "/test/app/state") return new Response(JSON.stringify(st.state), { status: 200 });
    return new Response(JSON.stringify({ testers: "x" }), { status: 200 });
  },
}));

const KANE: Row = { id: "u1", displayName: "Kane", role: "PLAYER", tester: false, testerAt: null, mcUuid: "0f2a7c3e9d1b4c6a8e5f7a9b1c3d5e7f", mcUsername: "KaneFinch", verifiedAt: new Date("2026-10-01T10:00:00Z") };
const ROWAN: Row = { id: "u2", displayName: "Rowan", role: "PLAYER", tester: false, testerAt: null, mcUuid: null, mcUsername: null, verifiedAt: null };

beforeEach(async () => {
  st.rows = [{ ...KANE }, { ...ROWAN }];
  st.audits = [];
  st.calls = [];
  st.state = { testers: null };
  st.reachable = true;
  st.configured = true;
  (await import("@/server/testers")).resetTesterChecks();
});

describe("the Tester switch", () => {
  it("one click on: saved at once, audited with who did it, and the test server told", async () => {
    const { setTester } = await import("@/server/testers");
    expect(await setTester("u1", true, "admin1")).toEqual({ ok: true, changed: true, told: true });
    expect(st.rows[0]).toMatchObject({ tester: true });
    expect(st.rows[0]!.testerAt).toBeInstanceOf(Date);
    expect(st.audits).toEqual([{ userId: "admin1", action: "user.tester", params: { id: "u1", displayName: "Kane", mcUsername: "KaneFinch", on: true, told: true }, result: "OK" }]);
    expect(st.calls).toEqual([{ path: "/test/app/tester", method: "POST", body: { uuid: KANE.mcUuid, name: "KaneFinch", on: true } }]);
  });
  it("one click off: the same, the other way, and 'since' goes", async () => {
    const { setTester } = await import("@/server/testers");
    await setTester("u1", true, "admin1");
    st.calls = [];
    expect(await setTester("u1", false, "admin1")).toEqual({ ok: true, changed: true, told: true });
    expect(st.rows[0]).toMatchObject({ tester: false, testerAt: null });
    expect(st.calls[0]!.body).toEqual({ uuid: KANE.mcUuid, name: "KaneFinch", on: false });
  });
  it("cannot be turned on for a member with no linked Minecraft account", async () => {
    const { setTester, isLinked } = await import("@/server/testers");
    expect(isLinked(ROWAN)).toBe(false);
    expect(isLinked({ ...ROWAN, mcUuid: "a".repeat(32), mcUsername: "Rowan" })).toBe(false); // not verified
    expect(await setTester("u2", true, "admin1")).toEqual({ ok: false, why: "not_linked" });
    expect(st.rows[1]!.tester).toBe(false);
    expect(st.audits).toEqual([]);
    expect(st.calls).toEqual([]);
  });
  it("the test server out of reach does not stop the switch; the list check puts it right later", async () => {
    const { setTester } = await import("@/server/testers");
    st.reachable = false;
    expect(await setTester("u1", true, "admin1")).toEqual({ ok: true, changed: true, told: false });
    expect(st.rows[0]!.tester).toBe(true);
    expect(st.audits[0]!.params.told).toBe(false);
  });
  it("pressed twice: changed once, audited once", async () => {
    const { setTester } = await import("@/server/testers");
    await setTester("u1", true, "admin1");
    expect(await setTester("u1", true, "admin1")).toEqual({ ok: true, changed: false, told: false });
    expect(st.audits).toHaveLength(1);
  });
});

describe("the existing ways out turn it off (docs/57 §3)", () => {
  it("removed: the row is gone already, so the old row is told off and audited with why", async () => {
    const { testerGone } = await import("@/server/testers");
    await testerGone("removed and blocked", "admin1", { gone: { ...KANE, tester: true } });
    expect(st.calls[0]).toEqual({ path: "/test/app/tester", method: "POST", body: { uuid: KANE.mcUuid, name: "KaneFinch", on: false } });
    expect(st.audits[0]).toMatchObject({ userId: "admin1", action: "user.tester", params: { on: false, why: "removed and blocked" } });
  });
  it("left the Discord server: off in the database, audited by the site itself", async () => {
    const { setTester, testerGone } = await import("@/server/testers");
    await setTester("u1", true, "admin1");
    st.audits = [];
    await testerGone("left the Discord server", null, { id: "u1" });
    expect(st.rows[0]).toMatchObject({ tester: false, testerAt: null });
    expect(st.audits[0]).toMatchObject({ userId: null, params: { on: false, why: "left the Discord server" } });
  });
  it("someone who was no tester: nothing is done, nothing is written", async () => {
    const { testerGone } = await import("@/server/testers");
    await testerGone("unlinked", "admin1", { id: "u1" });
    await testerGone("removed", "admin1", { gone: { ...ROWAN } });
    expect(st.calls).toEqual([]);
    expect(st.audits).toEqual([]);
  });
});

describe("the test server's list against this site's", () => {
  it("the same fingerprint: nothing sent", async () => {
    const { checkTesters } = await import("@/server/testers");
    const { testersHash } = await import("@/shared/testers");
    expect(await checkTesters(testersHash([]))).toBe("same");
    expect(st.calls).toEqual([]);
  });
  it("an api-test that has just started (null): the whole list is sent", async () => {
    const { checkTesters, setTester } = await import("@/server/testers");
    await setTester("u1", true, "admin1");
    st.calls = [];
    expect(await checkTesters(null)).toBe("sent");
    expect(st.calls).toEqual([{ path: "/test/app/tester", method: "POST", body: { testers: [{ uuid: KANE.mcUuid, name: "KaneFinch" }] } }]);
  });
  it("asked for itself at most once a minute, and the whole list at most every ten seconds", async () => {
    const { checkTesters } = await import("@/server/testers");
    const t = 1_000_000;
    expect(await checkTesters(undefined, t)).toBe("sent"); // asked the state (null), sent the list
    expect(st.calls.map((c) => c.path)).toEqual(["/test/app/state", "/test/app/tester"]);
    expect(await checkTesters(undefined, t + 30_000)).toBe("later");
    expect(await checkTesters("different", t + 5_000)).toBe("later");
    expect(await checkTesters("different", t + 11_000)).toBe("sent");
    expect(st.calls).toHaveLength(3);
  });
  it("with no test server set up, nothing is asked", async () => {
    const { checkTesters } = await import("@/server/testers");
    st.configured = false;
    expect(await checkTesters()).toBe("off");
    expect(st.calls).toEqual([]);
  });
});

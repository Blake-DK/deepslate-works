import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acknowledgeNotice, inWindow, noticeFor, noticeLabel, NOTICE_HOURS, type AckDeps, type NoticeRow } from "@/server/auth/signin-notice-core";
import { originIsForeign } from "@/server/same-origin";
import { describeAction } from "@/shared/events";

// The admin sign-in notice can be acknowledged (Alex, 2026-10-07): each admin's own "seen up to" time.

const T0 = 1_790_000_000_000; // a fixed "now"
const MIN = 60_000;
const ADMIN_A = { id: "a1", role: "ADMIN" as const };
const ADMIN_B = { id: "b2", role: "ADMIN" as const };
const PLAYER = { id: "p3", role: "PLAYER" as const };

function world() {
  let now = T0;
  let next = 1n;
  const events: NoticeRow[] = [];
  const seen = new Map<string, Date>();
  const audits: Array<{ userId: string; covered: number }> = [];
  const deps: AckDeps = {
    seenAt: async (id) => seen.get(id) ?? null,
    list: async (w, take) => events.filter((e) => inWindow(e.at, w)).sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, take),
    now: () => now,
    find: async (id) => events.find((e) => e.id === id) ?? null,
    count: async (w, upTo) => events.filter((e) => inWindow(e.at, w) && e.at <= upTo).length,
    advance: async (id, at) => {
      const was = seen.get(id);
      if (was && was >= at) return false;
      seen.set(id, at);
      return true;
    },
    audit: async (userId, covered) => void audits.push({ userId, covered }),
  };
  const signIn = (actor: string, minutesAgo = 0) => {
    const e = { id: next++, at: new Date(now - minutesAgo * MIN), actor, message: `${actor} signed in with password + code` };
    events.push(e);
    return e;
  };
  return { deps, seen, audits, signIn, later: (m: number) => (now += m * MIN), now: () => now };
}

const ack = (w: ReturnType<typeof world>, viewer: { id: string; role: "ADMIN" | "PLAYER" }, shown: string | bigint | null, foreign = false) =>
  acknowledgeNotice({ viewer, foreign, shown: shown === null ? "" : String(shown) }, w.deps);

describe("the notice for an admin who has acknowledged nothing", () => {
  it("lists every password or one-time-link sign-in of the last 24 hours, newest first, as before", async () => {
    const w = world();
    w.signIn(ADMIN_B.id, NOTICE_HOURS * 60 + 1); // a day and a minute ago: too old
    const older = w.signIn(ADMIN_B.id, 120);
    const newer = w.signIn(ADMIN_A.id, 5);
    const n = await noticeFor(ADMIN_A.id, w.deps);
    expect(n.rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(n.newest).toBe(newer.id);
  });
  it("shows nothing when there are no sign-ins in the last 24 hours", async () => {
    const w = world();
    w.signIn(ADMIN_A.id, NOTICE_HOURS * 60 + 1);
    expect(await noticeFor(ADMIN_A.id, w.deps)).toMatchObject({ rows: [], newest: null });
  });
});

describe("acknowledging", () => {
  it("hides those sign-ins from that admin and still shows them to a second admin", async () => {
    const w = world();
    const first = w.signIn(ADMIN_A.id, 30);
    const second = w.signIn(ADMIN_B.id, 10);
    expect(await ack(w, ADMIN_A, second.id)).toEqual({ ok: true, covered: 2, seenAt: second.at });
    expect((await noticeFor(ADMIN_A.id, w.deps)).newest).toBeNull();
    expect((await noticeFor(ADMIN_B.id, w.deps)).rows.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(w.audits).toEqual([{ userId: ADMIN_A.id, covered: 2 }]);
  });
  it("shows a newer sign-in again, and only that one", async () => {
    const w = world();
    const old = w.signIn(ADMIN_A.id, 30);
    await ack(w, ADMIN_A, old.id);
    w.later(15);
    const fresh = w.signIn(ADMIN_B.id);
    const n = await noticeFor(ADMIN_A.id, w.deps);
    expect(n.rows.map((r) => r.id)).toEqual([fresh.id]);
    expect(await ack(w, ADMIN_A, fresh.id)).toMatchObject({ ok: true, covered: 1 });
  });
  it("stops at the newest sign-in shown, so one that lands between page load and the click is not swallowed", async () => {
    const w = world();
    const shown = w.signIn(ADMIN_A.id, 2);
    const n = await noticeFor(ADMIN_A.id, w.deps);
    const meanwhile = w.signIn(ADMIN_B.id, 1);
    expect(await ack(w, ADMIN_A, n.newest)).toMatchObject({ ok: true, covered: 1, seenAt: shown.at });
    expect((await noticeFor(ADMIN_A.id, w.deps)).rows.map((r) => r.id)).toEqual([meanwhile.id]);
  });
  it("never moves the time backwards: an older sign-in, or the same one again, is refused and not audited", async () => {
    const w = world();
    const older = w.signIn(ADMIN_A.id, 20);
    const newer = w.signIn(ADMIN_A.id, 10);
    await ack(w, ADMIN_A, newer.id);
    expect(await ack(w, ADMIN_A, older.id)).toEqual({ ok: false, why: "not on the notice" });
    expect(await ack(w, ADMIN_A, newer.id)).toEqual({ ok: false, why: "not on the notice" });
    expect(w.seen.get(ADMIN_A.id)).toEqual(newer.at);
    expect(w.audits).toHaveLength(1);
  });
  it("is never automatic: an admin's own sign-in shows until they click", async () => {
    const w = world();
    w.signIn(ADMIN_A.id);
    w.later(60);
    expect((await noticeFor(ADMIN_A.id, w.deps)).rows).toHaveLength(1);
  });
});

describe("the action refuses", () => {
  it("a player", async () => {
    const w = world();
    const e = w.signIn(ADMIN_A.id, 5);
    expect(await ack(w, PLAYER, e.id)).toEqual({ ok: false, why: "not an admin" });
    expect(w.seen.size).toBe(0);
  });
  it("a request from another site", async () => {
    const w = world();
    const e = w.signIn(ADMIN_A.id, 5);
    expect(await ack(w, ADMIN_A, e.id, true)).toEqual({ ok: false, why: "another site" });
    expect(w.seen.size).toBe(0);
    expect(originIsForeign("https://evil.dsw.test", "deepslate.dsw.test")).toBe(true);
    expect(originIsForeign("null", "deepslate.dsw.test")).toBe(true);
    expect(originIsForeign("https://deepslate.dsw.test", "deepslate.dsw.test")).toBe(false);
  });
  it("a time in the future: a sign-in dated later than now, or a time sent instead of an event id", async () => {
    const w = world();
    const ahead = w.signIn(ADMIN_A.id, -10); // ten minutes from now
    expect(await ack(w, ADMIN_A, ahead.id)).toEqual({ ok: false, why: "in the future" });
    expect(await ack(w, ADMIN_A, "2099-01-01T00:00:00Z")).toEqual({ ok: false, why: "not an event id" });
    expect(await ack(w, ADMIN_A, String(Number.MAX_SAFE_INTEGER) + "0000")).toEqual({ ok: false, why: "not an event id" });
    expect(w.seen.size).toBe(0);
  });
  it("an event that is not on the notice (unknown id, or older than 24 hours)", async () => {
    const w = world();
    const old = w.signIn(ADMIN_A.id, NOTICE_HOURS * 60 + 5);
    expect(await ack(w, ADMIN_A, 999n)).toEqual({ ok: false, why: "not a notice sign-in" });
    expect(await ack(w, ADMIN_A, old.id)).toEqual({ ok: false, why: "not on the notice" });
  });
  it("is wired to the admin check and the origin check, and takes nothing from the page but the id shown", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "server", "auth", "signin-notice-actions.ts"), "utf8");
    expect(src).toMatch(/requireAdmin\(\)/);
    expect(src).toMatch(/foreign: await actionFromAnotherSite\(\)/);
    expect([...src.matchAll(/formData\.get\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(["shown"]);
  });
});

describe("the button", () => {
  it('reads "That was me" only when every listed sign-in is the viewer\'s own', () => {
    expect(noticeLabel([{ actor: ADMIN_A.id }, { actor: ADMIN_A.id }], ADMIN_A.id)).toBe("That was me");
    expect(noticeLabel([{ actor: ADMIN_A.id }, { actor: ADMIN_B.id }], ADMIN_A.id)).toBe("Seen it");
    expect(noticeLabel([{ actor: ADMIN_B.id }], ADMIN_A.id)).toBe("Seen it");
    expect(noticeLabel([{ actor: null }], ADMIN_A.id)).toBe("Seen it");
  });
  it("follows what the viewer is shown", async () => {
    const w = world();
    w.signIn(ADMIN_A.id, 5);
    expect((await noticeFor(ADMIN_A.id, w.deps)).label).toBe("That was me");
    expect((await noticeFor(ADMIN_B.id, w.deps)).label).toBe("Seen it");
  });
});

describe("the audit line", () => {
  it("says how many sign-ins it covered and nothing more", () => {
    const actor = { role: "ADMIN" as const, name: "Bramble09" };
    expect(describeAction("auth.signInNoticeSeen", actor, { covered: 2 })).toBe("Bramble09 marked 2 password sign-ins on the admin notice as seen");
    expect(describeAction("auth.signInNoticeSeen", actor, { covered: 1 })).toBe("Bramble09 marked 1 password sign-in on the admin notice as seen");
  });
});

import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { testAppCall } from "@/server/api-client";
import { testAppConfigured } from "@/server/test-app";
import { testersHash, type Tester } from "@/shared/testers";

// docs/57, testers (planner and Alex, 2026-10-12), the live site's half. A member with the Tester switch on gets the
// app's Test tab, the test server's whitelist and a test door that lets them straight in; never the test site, never
// anything of an admin's. One click on Admin → People (or on the Test server card) turns it on or off; every change is
// audited as `user.tester`. The test server's api is told each change (POST /test/app/tester, TEST_APP_TOKEN), and the
// whole list whenever its fingerprint of the list is not this site's (it has just started, or a change did not get
// through, or the live api turned the switch off for someone who left the Discord server).

/** Linked: a Minecraft account the in-game link or an admin verified. Only then can the switch be turned on. */
export const isLinked = (u: { mcUuid: string | null; mcUsername: string | null; verifiedAt: Date | null }) => Boolean(u.mcUuid && u.mcUsername && u.verifiedAt);

export const LINK_FIRST = "Link their Minecraft account first";

/** The testers the test server should have: the switch on and a linked account (an admin with it on stays on it). */
export async function testerRows() {
  return db.user.findMany({
    where: { tester: true, mcUuid: { not: null }, mcUsername: { not: null }, verifiedAt: { not: null } },
    orderBy: { testerAt: "asc" },
    select: { id: true, displayName: true, role: true, mcUuid: true, mcUsername: true, testerAt: true },
  });
}

export async function testerList(): Promise<Tester[]> {
  return (await testerRows()).map((u) => ({ uuid: u.mcUuid!, name: u.mcUsername! }));
}

/** Tells the test server's api one change. False when it was not reached; the list check then puts it right. */
async function tell(t: Tester & { on: boolean }): Promise<boolean> {
  if (!testAppConfigured()) return false;
  const res = await testAppCall("/test/app/tester", { method: "POST", body: t, timeoutMs: 8000 });
  return Boolean(res?.ok);
}

export type SetTester = { ok: true; changed: boolean; told: boolean } | { ok: false; why: "missing" | "not_linked" };

/** The switch, from an admin's click. On only for a linked member. */
export async function setTester(id: string, on: boolean, byId: string): Promise<SetTester> {
  const u = await db.user.findUnique({ where: { id }, select: { displayName: true, tester: true, mcUuid: true, mcUsername: true, verifiedAt: true } });
  if (!u) return { ok: false, why: "missing" };
  if (on && !isLinked(u)) return { ok: false, why: "not_linked" };
  if (u.tester === on) return { ok: true, changed: false, told: false };
  await db.user.update({ where: { id }, data: { tester: on, testerAt: on ? new Date() : null } });
  const told = u.mcUuid && u.mcUsername ? await tell({ uuid: u.mcUuid, name: u.mcUsername, on }) : false;
  await audit({ userId: byId, action: "user.tester", params: { id, displayName: u.displayName, mcUsername: u.mcUsername, on, told }, result: "OK" });
  return { ok: true, changed: true, told };
}

/**
 * The switch off by one of the existing paths (docs/57 §3): removed, blocked, unlinked, linked to another account, or
 * left the Discord server. `gone` is the row as it was, for a member whose row is deleted already. Audited by `byId`
 * (null: the site itself) with why.
 */
export async function testerGone(why: string, byId: string | null, who: { id: string } | { gone: { id: string; displayName: string; tester: boolean; mcUuid: string | null; mcUsername: string | null } }) {
  const found = "gone" in who ? who.gone : await db.user.findUnique({ where: { id: who.id }, select: { id: true, displayName: true, tester: true, mcUuid: true, mcUsername: true } });
  if (!found?.tester) return;
  const u = { ...found };
  if (!("gone" in who)) await db.user.update({ where: { id: u.id }, data: { tester: false, testerAt: null } });
  const told = u.mcUuid && u.mcUsername ? await tell({ uuid: u.mcUuid, name: u.mcUsername, on: false }).catch(() => false) : false;
  await audit({ userId: byId, action: "user.tester", params: { id: u.id, displayName: u.displayName, mcUsername: u.mcUsername, on: false, why, told }, result: "OK" });
}

/** At most one look at the test server's list a minute, and one whole list sent every ten seconds. */
const LOOK_MS = 60_000;
const SEND_MS = 10_000;
let lookedAt = 0;
let sentAt = 0;

/**
 * The test server's list against this site's: `seen` is the fingerprint a /test/app/state answer just gave (undefined:
 * ask for it, at most once a minute). When they differ, the whole list is sent. Never throws; nothing waits on it.
 */
export async function checkTesters(seen?: string | null, now = Date.now()): Promise<"off" | "later" | "same" | "sent" | "failed"> {
  try {
    if (!testAppConfigured()) return "off";
    if (seen === undefined) {
      if (now - lookedAt < LOOK_MS) return "later";
      lookedAt = now;
      const res = await testAppCall("/test/app/state", { timeoutMs: 5000 });
      if (!res?.ok) return "failed";
      seen = ((await res.json().catch(() => ({}))) as { testers?: string | null }).testers ?? null;
    }
    const list = await testerList();
    if (seen === testersHash(list)) return "same";
    if (now - sentAt < SEND_MS) return "later";
    sentAt = now;
    const res = await testAppCall("/test/app/tester", { method: "POST", body: { testers: list }, timeoutMs: 15_000 });
    return res?.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** For tests: the minute and the ten seconds start again. */
export function resetTesterChecks() {
  lookedAt = 0;
  sentAt = 0;
}

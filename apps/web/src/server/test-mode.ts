import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { apiFetch } from "@/server/api-client";
import { db } from "@/server/db";

// docs/42: what the test server's site (TEST_MODE=1) knows about itself. On the live site every function here answers
// as if there were no test server: getTestState() is null, seasonNow() the real time, testRefusal() null.

/** docs/42 T3: Lock, Apply results and every other write to git are refused on the test site, in these words. */
export const TEST_NO_GIT = "The test site never writes to git";
export const testRefusal = (): string | null => (env.TEST_MODE ? TEST_NO_GIT : null);

export type TestState = {
  clock: { on: boolean; pretending: boolean; now: string; pretendSince: { pretend: string; setAt: string } | null };
  images: string | null;
  checkout: string | null;
  season: { id: string; name: string; state: "upcoming" | "running" | "ended" | null; startsAt: string; endsAt: string; quick: { opening: string; nextDrop: string | null; finale: string | null } } | null;
  door: { playFirst: boolean; mustVote: boolean; newestApp: boolean };
};

let held: { at: number; v: TestState | null } | null = null;

/** api-test's /test/state, asked at most every 5 s; null on the live site, or when api-test does not answer. */
export async function getTestState(fresh = false): Promise<TestState | null> {
  if (!env.TEST_MODE) return null;
  if (!fresh && held && Date.now() - held.at < 5_000) return held.v;
  const v = await apiFetch<TestState>("/test/state", { timeoutMs: 3000 }).catch(() => null);
  held = { at: Date.now(), v };
  return v;
}

/**
 * The time for a season on this site: the test clock's while one is set (docs/42 §7.1), else the real time. The clock
 * itself is api-test's (the Setting row "test.clock", which only api-test writes); this reads the same row.
 */
export async function seasonNow(): Promise<Date> {
  if (!env.TEST_MODE) return new Date();
  const row = await db.setting.findUnique({ where: { key: "test.clock" } }).catch(() => null);
  const v = row?.value as { pretend?: unknown; setAt?: unknown } | null | undefined;
  const p = typeof v?.pretend === "string" ? Date.parse(v.pretend) : NaN;
  const s = typeof v?.setAt === "string" ? Date.parse(v.setAt) : NaN;
  return Number.isFinite(p) && Number.isFinite(s) ? new Date(Date.now() + (p - s)) : new Date();
}

/** "1.0.0+abcd1234", as the footer shows a pack: mods.json's version and the lock's hash. Null when it does not read. */
export async function packIn(modpackDir: string): Promise<string | null> {
  try {
    const [m, lock] = await Promise.all([readFile(path.join(modpackDir, "mods.json"), "utf8"), readFile(path.join(modpackDir, "mods.lock.json"), "utf8")]);
    const version = (JSON.parse(m) as { version?: unknown }).version;
    const hash = (JSON.parse(lock) as { hash?: unknown }).hash;
    return typeof version === "string" && typeof hash === "string" && hash.length >= 8 ? `${version}+${hash.slice(0, 8)}` : null;
  } catch {
    return null;
  }
}

/**
 * docs/42 T4: the pack this test checkout has and the pack the live site hands out to every PC. When they differ, the
 * PCs (which have the live pack) will not match the test server. Null on the live site, or when either cannot be read.
 */
export async function packDrift(): Promise<{ test: string; live: string } | null> {
  if (!env.TEST_MODE || !env.LIVE_MODPACK_DIR) return null;
  const [test, live] = await Promise.all([packIn(process.env.MODPACK_DIR ?? "/repo/modpack"), packIn(env.LIVE_MODPACK_DIR)]);
  return test && live && test !== live ? { test, live } : null;
}

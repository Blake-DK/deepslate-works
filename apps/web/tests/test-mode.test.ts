import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode, getToken } from "next-auth/jwt";
import { sessionCookie } from "@/auth.config";

// docs/42: what TEST_MODE=1 changes in web (the test server's own site), and, for each, that with it unset (the live
// site) nothing changes.

const git = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    git.calls.push(args);
    cb(null, "", "");
  },
}));
const clockRow = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/db", () => ({ db: { setting: { findUnique: async () => (clockRow.value ? { value: clockRow.value } : null) } } }));

const LIVE_SECRET = "live-secret-live-secret-live-secret-00";
const TEST_SECRET = "test-secret-test-secret-test-secret-00";

describe("T2: the session cookie", () => {
  it("the test site's has a name of its own and belongs to its host only", () => {
    const test = sessionCookie({ testMode: true, secure: true, cookieDomain: ".deepslate.dsw.test" })!;
    expect(test.sessionToken.name).toBe("__Secure-dswtest.session-token");
    expect("domain" in test.sessionToken.options).toBe(false);
  });

  it("unset changes nothing: the live cookie is as it was, with or without the parent domain", () => {
    expect(sessionCookie({ testMode: false, secure: true, cookieDomain: ".deepslate.dsw.test" })).toEqual({
      sessionToken: { name: "__Secure-authjs.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: ".deepslate.dsw.test" } },
    });
    expect(sessionCookie({ testMode: false, secure: true })).toBeNull();
  });

  it("a live cookie alone signs nobody in on the test site", async () => {
    const live = sessionCookie({ testMode: false, secure: true, cookieDomain: ".deepslate.dsw.test" })!.sessionToken.name;
    const test = sessionCookie({ testMode: true, secure: true })!.sessionToken.name;
    const jwt = await encode({ token: { uid: "u-admin", role: "ADMIN" }, secret: LIVE_SECRET, salt: live });
    const req = (cookie: string) => new Request("https://test.deepslate.dsw.test/admin", { headers: { cookie } });
    // the live site reads it
    expect(await getToken({ req: req(`${live}=${jwt}`), secret: LIVE_SECRET, secureCookie: true, cookieName: live, salt: live })).toMatchObject({ uid: "u-admin" });
    // the test site does not: another name, and its own secret even if the name were the same
    expect(await getToken({ req: req(`${live}=${jwt}`), secret: TEST_SECRET, secureCookie: true, cookieName: test, salt: test })).toBeNull();
    expect(await getToken({ req: req(`${test}=${jwt}`), secret: TEST_SECRET, secureCookie: true, cookieName: test, salt: test })).toBeNull();
  });
});

async function fresh(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
  return {
    env: (await import("@/env")).env,
    mode: await import("@/server/test-mode"),
    manifest: await import("@/server/modpack/manifest"),
    api: await import("@/server/api-client"),
  };
}

describe("TEST_MODE in web", () => {
  beforeEach(() => {
    git.calls.splice(0);
    clockRow.value = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("T3: no write to git on the test site", async () => {
    const { mode, manifest } = await fresh({ TEST_MODE: "1" });
    expect(mode.testRefusal()).toBe("The test site never writes to git");
    expect(await manifest.commitManifest("chore(modpack): lock", { name: "Alex" })).toEqual({ ok: false, output: "The test site never writes to git" });
    await expect(manifest.writeManifest({} as never)).rejects.toThrow("The test site never writes to git");
    expect(git.calls).toEqual([]);
  });

  it("unset changes nothing: the live site commits as before", async () => {
    const { mode, manifest } = await fresh({ TEST_MODE: undefined });
    expect(mode.testRefusal()).toBeNull();
    expect((await manifest.commitManifest("chore(modpack): lock", { name: "Alex" }, ["modpack/mods.lock.json"])).ok).toBe(true);
    expect(git.calls.map((a) => a.find((x) => x === "add" || x === "commit"))).toEqual(["add", "commit"]);
  });

  it("§7.1: the season's time is the test clock's on the test site, and the real time on live", async () => {
    clockRow.value = { pretend: "2026-12-19T19:55:00.000Z", setAt: new Date(Date.now() - 60_000).toISOString() };
    const test = await fresh({ TEST_MODE: "1" });
    expect(Math.abs((await test.mode.seasonNow()).getTime() - Date.parse("2026-12-19T19:56:00Z"))).toBeLessThan(5_000);
    const live = await fresh({ TEST_MODE: undefined });
    expect(Math.abs((await live.mode.seasonNow()).getTime() - Date.now())).toBeLessThan(5_000);
    expect(await live.mode.getTestState()).toBeNull();
    expect(await live.mode.packDrift()).toBeNull();
  });

  it("§8: Live | Test goes to the other site of the pair, and only while there is a test server", async () => {
    expect((await fresh({ TEST_MODE: "1", LIVE_SITE_URL: "https://deepslate.dsw.test/" })).env.otherSite).toEqual({ label: "Live", url: "https://deepslate.dsw.test" });
    expect((await fresh({ TEST_MODE: undefined, TEST_STACK: "1", TEST_SITE_URL: "https://test.deepslate.dsw.test" })).env.otherSite).toEqual({ label: "Test", url: "https://test.deepslate.dsw.test" });
    expect((await fresh({ TEST_MODE: undefined, TEST_STACK: "0", TEST_SITE_URL: "https://test.deepslate.dsw.test" })).env.otherSite).toBeNull();
    expect((await fresh({ TEST_MODE: undefined, TEST_STACK: undefined, TEST_SITE_URL: undefined })).env.otherSite).toBeNull();
  });

  it("T9: the live site asks the test server's summary only while TEST_STACK=1, never from the test site", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      fetched.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(JSON.stringify({ state: "asleep" }), { status: 200 });
    });
    try {
      const token = "m".repeat(40);
      expect(await (await fresh({ TEST_MODE: undefined, TEST_STACK: "0", TEST_SUMMARY_TOKEN: token })).api.testServerSummary()).toBeNull();
      expect(await (await fresh({ TEST_MODE: "1", TEST_STACK: "1", TEST_SUMMARY_TOKEN: token })).api.testServerSummary()).toBeNull();
      expect(fetched).toEqual([]);
      expect(await (await fresh({ TEST_MODE: undefined, TEST_STACK: "1", TEST_SUMMARY_TOKEN: token, TEST_API_URL: "http://deepslate-wg:4001" })).api.testServerSummary()).toEqual({ state: "asleep" });
      expect(fetched).toEqual([`http://deepslate-wg:4001/test/summary Bearer ${token}`]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

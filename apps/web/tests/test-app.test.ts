import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/45: the launcher's Test section, version one. Admins only; anyone else gets the missing-page answer on every route.

const who = vi.hoisted(() => ({ user: null as null | { id: string; role: string; displayName: string; discordId: string | null; pcTier: string | null } }));
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/server/launcher", () => ({ bearer: () => "t".repeat(32), userFromLauncherToken: async () => who.user }));
vi.mock("@/env", () => ({ env: { TEST_MODE: false, TEST_STACK: true, TEST_APP_TOKEN: "a".repeat(64), TEST_API_URL: "http://deepslate-wg:4001", AUTH_URL: "https://deepslate.dsw.test" } }));
vi.mock("@/server/events", () => ({ audit: async () => {} }));
vi.mock("@/server/modpack/lock", () => ({ getInstaller: async () => ({ version: "3.5.5", exe: { version: "3.5.5", sha256: "x".repeat(64), size: 1 } }) }));
vi.mock("@/server/branding", () => ({ getBranding: async () => ({ generated: null }), readLogoBase64: async () => null }));
const LOCK = { generatedAt: "2026-10-09T08:00:00Z", minecraft: "1.21.1", neoforge: "21.1.253", hash: "d44eb2ba".padEnd(64, "0"), configs: [{ path: "config/a.toml", sha256: "0".repeat(64) }],
  files: [{ slug: "create", name: "Create", filename: "create.jar", url: "https://cdn.modrinth.com/create.jar", sha512: "1".repeat(128), size: 10, side: "both" }, { slug: "worldedit", name: "WorldEdit", filename: "we.jar", url: "https://cdn.modrinth.com/we.jar", sha512: "2".repeat(128), size: 10, side: "server" }] };
const MODS = JSON.parse(readFileSync(new URL("../../../modpack/mods.json", import.meta.url), "utf8")) as { name: string; version: string; profile: { dir: string } };
vi.mock("@/server/api-client", () => ({
  testAppCall: async (p: string) => {
    calls.list.push(p);
    if (p === "/test/app/pack") return new Response(JSON.stringify({ mods: MODS, lock: LOCK }), { status: 200 });
    if (p === "/test/app/state") return new Response(JSON.stringify({ state: "asleep", players: [], address: "lab.dsw.test", pack: { site: "0.1.0+d44eb2ba", server: "0.1.0+d44eb2ba" } }), { status: 200 });
    if (p === "/test/app/wake") return new Response(JSON.stringify({ result: "started" }), { status: 202 });
    return new Response(new Uint8Array([80, 75]), { status: 200, headers: { "content-length": "2" } });
  },
}));

const req = (path: string, method = "GET") => new Request(`https://deepslate.dsw.test${path}`, { method, headers: { authorization: "Bearer x" } });
const routes = async () => ({
  section: (await import("@/app/api/app/test/route")).GET,
  manifest: (await import("@/app/api/app/test/manifest/route")).GET,
  config: (await import("@/app/api/app/test/config.zip/route")).GET,
  wake: (await import("@/app/api/app/test/wake/route")).POST,
});

beforeEach(() => { calls.list = []; });

describe("a member who is not an admin, or nobody (answered as a path that does not exist)", () => {
  for (const user of [null, { id: "u1", role: "PLAYER", displayName: "Bramble09", discordId: "123456789012345678", pcTier: null }]) {
    it(`${user ? "a player's app" : "an app with no valid token"}: every route gives the middleware's 401 for an unknown path, and the test stack is never asked`, async () => {
      who.user = user;
      const r = await routes();
      for (const res of [await r.section(req("/api/app/test")), await r.manifest(req("/api/app/test/manifest")), await r.config(req("/api/app/test/config.zip")), await r.wake(req("/api/app/test/wake", "POST"))]) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "Sign in first" } });
      }
      expect(calls.list).toEqual([]);
    });
  }
  it("a signed-in browser (a session cookie) gets the 404 of a missing page", async () => {
    who.user = null;
    const r = await routes();
    const withCookie = new Request("https://deepslate.dsw.test/api/app/test", { headers: { cookie: "__Secure-authjs.session-token=abc" } });
    await expect(r.section(withCookie)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the middleware's door for the Test section", () => {
  it("lets an app's request (a launcher token) through to the four routes, and nothing else", async () => {
    const { appTokenRequest } = await import("@/lib/test-app-paths");
    const tok = "Bearer " + "t".repeat(40);
    for (const p of ["/api/app/test", "/api/app/test/manifest", "/api/app/test/config.zip", "/api/app/test/wake"]) {
      expect(appTokenRequest(p, tok)).toBe(true);
      expect(appTokenRequest(p, null)).toBe(false);
      expect(appTokenRequest(p, "Bearer short")).toBe(false);
    }
    for (const p of ["/api/app/test/other", "/api/app/testx", "/api/admin/console/send"]) expect(appTokenRequest(p, tok)).toBe(false);
  });
});

describe("an admin", () => {
  beforeEach(() => { who.user = { id: "a1", role: "ADMIN", displayName: "Alex", discordId: "123456789012345678", pcTier: "mid" }; });
  it("sees the section with the test server's state and pack", async () => {
    const res = await (await routes()).section(req("/api/app/test"));
    expect(await res.json()).toEqual({ available: true, state: "asleep", players: 0, address: "lab.dsw.test", pack: "0.1.0+d44eb2ba", serverPack: "0.1.0+d44eb2ba" });
  });
  it("gets the test pack in the live manifest's shape: its own folder and profile, the test address, the live app channel", async () => {
    const m = (await (await (await routes()).manifest(req("/api/app/test/manifest"))).json()) as Record<string, unknown>;
    expect(m.test).toBe(true);
    expect(m.version).toBe("0.1.0+d44eb2ba");
    expect(m.profile).toEqual({ id: "deepslate-works-test", dir: ".minecraft-deepslate-works-test", name: "Deepslate Works TEST", icon: "Furnace" });
    expect(m.profile).not.toEqual(expect.objectContaining({ dir: MODS.profile.dir }));
    expect(m.server_address).toBe("lab.dsw.test");
    expect(m.config_url).toBe("https://deepslate.dsw.test/api/app/test/config.zip");
    expect((m.installer as { exe?: { version: string } } | null)?.exe?.version ?? (m.installer as { version?: string })?.version).toBe("3.5.5"); // the live channel
    expect((m.files as Array<{ url: string; sha512: string }>).every((f) => f.url.startsWith("https://cdn.modrinth.com/") && f.sha512.length === 128)).toBe(true);
  });
  it("wakes the test server through the live site", async () => {
    const res = await (await routes()).wake(req("/api/app/test/wake", "POST"));
    expect(res.status).toBe(202);
    expect(calls.list).toEqual(["/test/app/wake"]);
  });
  it("gets the settings bundle passed through", async () => {
    const res = await (await routes()).config(req("/api/app/test/config.zip"));
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([80, 75]));
  });
});

describe("test Play reports", () => {
  it("have a mode of their own that the door's Play check never counts", async () => {
    const { MODES } = await import("@/lib/install-report");
    const { PLAY_MODES } = await import("@/shared/join-gate");
    expect(MODES).toContain("test_play");
    expect(PLAY_MODES as readonly string[]).not.toContain("test_play");
  });
});

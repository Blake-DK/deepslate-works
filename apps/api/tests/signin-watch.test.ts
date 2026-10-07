import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { HealthWatch } from "../src/status/health-watch.js";
import { signInRoutes } from "../src/routes/signin.js";
import { freshSignIn, SIGNIN_FAILS, SIGNIN_WINDOW_MIN, signInStep, SignInWatch } from "../src/status/signin-watch.js";

// 2026-10-06 19:58 UTC to 2026-10-07 09:47 UTC: every Discord sign-in failed and nobody was told.
const t0 = new Date("2026-10-06T19:58:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

describe("the sign-in watch", () => {
  it("a run of failures raises one alert, not one per failure", () => {
    const w = new SignInWatch();
    const said = [0, 1, 2, 3, 4, 60, 600].map((m) => w.record("discord", false, at(m)));
    expect(said.filter(Boolean)).toHaveLength(1);
    expect(said[SIGNIN_FAILS - 1]).toEqual({
      level: "ERROR",
      message: `Health: Discord sign-in is failing: 3 failed in the last ${SIGNIN_WINDOW_MIN} minutes and none worked. The site's log has the reason under [auth][error]`,
    });
    expect(w.view()).toEqual({ failing: ["discord"] });
  });

  it("a sign-in that works clears it, says so once, and the next run alerts again", () => {
    const w = new SignInWatch();
    for (const m of [0, 1, 2, 3]) w.record("discord", false, at(m));
    expect(w.record("discord", true, at(829))).toEqual({ level: "WARN", message: "Health, well again: Discord sign-in works again (4 failed while it was broken)" });
    expect(w.view()).toEqual({ failing: [] });
    expect(w.record("discord", true, at(830))).toBeNull();
    const again = [900, 901, 902].map((m) => w.record("discord", false, at(m)));
    expect(again.map((a) => a?.level ?? null)).toEqual([null, null, "ERROR"]);
  });

  it("a success in between, or failures spread wider than the window, is no alert", () => {
    const w = new SignInWatch();
    expect([w.record("discord", false, at(0)), w.record("discord", false, at(1)), w.record("discord", true, at(2)), w.record("discord", false, at(3)), w.record("discord", false, at(4))].filter(Boolean)).toEqual([]);
    let s = freshSignIn();
    for (const m of [0, SIGNIN_WINDOW_MIN, 2 * SIGNIN_WINDOW_MIN]) {
      const r = signInStep(s, "discord", false, at(m));
      expect(r.alert).toBeNull();
      s = r.state;
    }
  });

  it("each method counts on its own: a password that works does not hide Discord failing", () => {
    const w = new SignInWatch();
    w.record("discord", false, at(0));
    w.record("discord", false, at(1));
    w.record("admin-password", true, at(2));
    expect(w.record("discord", false, at(3))?.level).toBe("ERROR");
    expect(w.view()).toEqual({ failing: ["discord"] });
  });

  it("the health watch writes the alert as an event the admin channel gets, with the outcome and nothing else", async () => {
    const events: Array<{ kind: string; message: string; meta: Record<string, unknown> }> = [];
    let clock = t0;
    const watch = new HealthWatch({
      amp: { call: async () => [] } as never, dumpsDir: "/nowhere-for-this-test", repoDir: "/nowhere-for-this-test",
      copied: () => null, serverPack: async () => null, wake: () => ({ phase: "idle", by: null, endedAt: null }),
      addEvent: async (e) => void events.push(e), log: () => undefined, now: () => clock,
    });
    for (const m of [0, 5, 10, 15]) {
      clock = at(m);
      await watch.signInOutcome("discord", false);
    }
    clock = at(829);
    await watch.signInOutcome("discord", true);
    expect(events.map((e) => [e.kind, e.meta])).toEqual([
      ["ERROR", { health: "signin", method: "discord" }],
      ["WARN", { health: "signin", method: "discord" }],
    ]);
  });

  it("the route takes a method and ok, and refuses anything else", async () => {
    const outcomes: unknown[] = [];
    const app = Fastify();
    signInRoutes(app, { signInOutcome: async (method: string, ok: boolean) => void outcomes.push([method, ok]) } as never);
    const post = (payload: unknown) => app.inject({ method: "POST", url: "/signin/outcome", payload: payload as object });
    expect((await post({ method: "discord", ok: false })).statusCode).toBe(200);
    expect((await post({ method: "github", ok: false })).statusCode).toBe(400);
    expect((await post({ method: "discord", ok: false, code: "x" })).statusCode).toBe(400);
    expect(outcomes).toEqual([["discord", false]]);
  });
});

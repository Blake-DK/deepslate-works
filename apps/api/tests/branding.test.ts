import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { motdValue, brandingRoutes, MOTD_NODE } from "../src/routes/branding.js";
import type { Amp } from "../src/amp/client.js";
import type { Env } from "../src/env.js";

// Branding (planner, 2026-10-01): the MOTD goes to AMP's ServerMOTD, the logo is made by `modpack build branding`.

describe("the server description", () => {
  it("is the two lines with a line break, nothing else", () => {
    expect(motdValue("§8Deepslate Works §6· modded with friends", "§7Create, guns")).toBe("§8Deepslate Works §6· modded with friends\n§7Create, guns");
    expect(motdValue("one\r\nline", "")).toBe("one  line");
  });
  it("is refused without AMP's permission, and sent and read back with it", async () => {
    const config: Record<string, unknown> = { [MOTD_NODE]: "Deepslate Works" };
    let allowed = false;
    const amp = {
      ping: async () => {},
      getStatus: async () => ({}) as never,
      hasPermission: async () => allowed,
      call: async <T,>(_m: string, method: string, p: Record<string, unknown> = {}) => {
        if (method === "GetConfig") return { CurrentValue: config[String(p.node)] } as T;
        if (method === "SetConfig") config[String(p.node)] = p.value;
        return { Status: true } as T;
      },
    } as unknown as Amp;
    const app = Fastify();
    app.addHook("onRequest", async (req) => {
      (req as unknown as { caller: unknown }).caller = { role: "ADMIN", userId: null };
    });
    brandingRoutes(app, { REPO_DIR: "/nonexistent" } as Env, amp);
    const post = () => app.inject({ method: "POST", url: "/branding/motd", payload: { line1: "a", line2: "b" } });
    expect((await post()).statusCode).toBe(403);
    allowed = true;
    const r = await post();
    expect(r.statusCode).toBe(200);
    expect(config[MOTD_NODE]).toBe("a\nb");
  });
  it("takes only a picked option or an upload as the logo's name", async () => {
    const app = Fastify();
    app.addHook("onRequest", async (req) => {
      (req as unknown as { caller: unknown }).caller = { role: "ADMIN", userId: null };
    });
    brandingRoutes(app, { REPO_DIR: "/nonexistent" } as Env, {} as Amp);
    const send = (choice: string, kind = "svg", data = Buffer.from("<svg viewBox='0 0 1 1'></svg>").toString("base64")) => app.inject({ method: "POST", url: "/branding/logo", payload: { choice, kind, data } });
    expect((await send("../../etc/passwd")).statusCode).toBe(400);
    expect((await send("option:2-ore-block", "png")).statusCode).toBe(400); // not a PNG
  });
});

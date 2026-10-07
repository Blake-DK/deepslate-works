import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlockList } from "modpack/design";
import { currentVersion, designerRefusal, designName, fixAsk, nameOf, overLimit, readAnswer, summary, titleOf, withVersion, type DesignFile } from "@/lib/designer";

// docs/39 Step 2: the build designer from the site. The designer's answers are read and checked here, the versions
// kept; the container is a small local server standing in for deepslate-designer.

const MODPACK = path.resolve(__dirname, "..", "..", "..", "modpack");
const BLOCKS = JSON.parse(readFileSync(path.join(MODPACK, "designer", "blocks.json"), "utf8")) as BlockList;
const GATE = JSON.parse(readFileSync(path.join(MODPACK, "designer", "examples", "gate.json"), "utf8")) as Record<string, unknown>;
const TOKEN = "k".repeat(40);

describe("any name (docs/40 Part 1)", () => {
  it("is made into small letters, digits and single _, accents off, 24 at most", () => {
    expect(designName("Boss Temple")).toBe("boss_temple");
    expect(designName("  Café  du   Nord!! ")).toBe("cafe_du_nord");
    expect(designName("Ødegård's Smedje")).toBe("odegard_s_smedje");
    expect(designName("Straße / Tor")).toBe("strasse_tor");
    expect(designName("The Great Hall of the Mountain King")).toBe("the_great_hall_of_the_mo");
    expect(designName("a-very-long-name-ending-in-a-dash-")).toBe("a_very_long_name_ending");
    expect(nameOf("___")).toBe("");
  });
  it("nothing usable typed: three words of the ask longer than two letters, else build", () => {
    expect(designName("", "A temple for the boss portal at spawn")).toBe("temple_for_the");
    expect(designName("!", "a 40 by 40 hall")).toBe("hall");
    expect(designName("x", "a b")).toBe("build");
  });
  it("a name a design or an upload has gets _2, _3 …, cut to fit", () => {
    expect(designName("Boss Temple", "", new Set(["boss_temple"]))).toBe("boss_temple_2");
    expect(designName("Boss Temple", "", new Set(["boss_temple", "boss_temple_2"]))).toBe("boss_temple_3");
    expect(designName("abcdefghijklmnopqrstuvwx", "", new Set(["abcdefghijklmnopqrstuvwx"]))).toBe("abcdefghijklmnopqrstuv_2");
  });
  it("keeps what was typed as the title, 60 characters at most", () => {
    expect(titleOf("  Boss   Temple ")).toBe("Boss Temple");
    expect(titleOf("   ")).toBeUndefined();
    expect(titleOf("x".repeat(80))).toHaveLength(60);
    const d = withVersion(null, "boss_temple", { at: "2026-10-07T08:00:00.000Z", ask: "a", say: "", recipe: GATE as never, ms: 1, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, fixed: false }, "Boss Temple");
    expect([d.title, withVersion(d, "boss_temple", currentVersion(d)).title, summary(d).title]).toEqual(["Boss Temple", "Boss Temple", "Boss Temple"]);
  });
});

describe("reading the designer's answer", () => {
  it("takes one JSON object with a recipe that passes, under the admin's name for it", () => {
    const a = readAnswer(JSON.stringify({ say: "A gate.", recipe: { ...GATE, name: "something_else" } }), "front_gate", BLOCKS);
    expect(a.kind).toBe("build");
    if (a.kind !== "build") return;
    expect(a.say).toBe("A gate.");
    expect(a.recipe.name).toBe("front_gate");
    expect(a.recipe.size).toEqual({ x: 11, y: 13, z: 5 });
  });
  it("takes the object in a code fence too", () => {
    expect(readAnswer("```json\n" + JSON.stringify({ say: "A gate.", recipe: GATE }) + "\n```", "gate", BLOCKS).kind).toBe("build");
  });
  it("a recipe our checks refuse comes back with the reason, to send to the designer once", () => {
    const bad = { ...GATE, steps: [{ op: "box", from: [0, 0, 0], to: [11, 1, 1], with: "minecraft:stone" }] };
    const a = readAnswer(JSON.stringify({ say: "A gate.", recipe: bad }), "gate", BLOCKS);
    expect(a).toEqual({ kind: "refused", say: "A gate.", reason: "step 1 reaches outside the size: x goes to 11, the size is 11 (0 to 10)", recipe: { ...bad, name: "gate" } });
    expect(fixAsk("step 1 reaches outside the size")).toBe("The recipe you returned was refused by the checks: step 1 reaches outside the size. Fix that, keep everything else, and return the whole recipe.");
  });
  it("no recipe: the designer's refusal line, or text that is not the one object", () => {
    expect(readAnswer('{"say":"I only design builds. Tell me what to build or what to change."}', "gate", BLOCKS)).toEqual({ kind: "none", text: "I only design builds. Tell me what to build or what to change." });
    expect(readAnswer("Here is your temple: {", "gate", BLOCKS)).toEqual({ kind: "none", text: "Here is your temple: {" });
    expect(readAnswer("[1, 2]", "gate", BLOCKS)).toEqual({ kind: "none", text: "[1, 2]" });
  });
});

describe("a design's versions", () => {
  const v = (ask: string) => ({ at: "2026-10-07T08:00:00.000Z", ask, say: "", recipe: { ...GATE, name: "gate" } as never, ms: 1000, tokens: { input: 1, cacheWrite: 0, cacheRead: 0, output: 9000 }, fixed: false });
  it("each answer is a new version, and the newest is current until another is picked", () => {
    let d: DesignFile = withVersion(null, "gate", v("a gate"));
    d = withVersion(d, "gate", v("taller"));
    expect([d.current, d.versions.map((x) => x.n)]).toEqual([2, [1, 2]]);
    d = withVersion({ ...d, current: 1, kept: { version: 1, at: "x" } }, "gate", v("wider"));
    expect([d.current, currentVersion(d).ask, d.kept]).toEqual([3, "wider", { version: 1, at: "x" }]);
    expect(summary(d)).toEqual({ name: "gate", versions: 3, current: 3, kept: 1, at: "2026-10-07T08:00:00.000Z" });
  });
  it("the limits: 30 an hour, DESIGNER_DAILY a day", () => {
    expect(overLimit(29, 79, 80)).toBeNull();
    expect(overLimit(30, 40, 80)).toMatch(/30 times in the last hour/);
    expect(overLimit(3, 80, 80)).toMatch(/80 times today/);
  });
  it("the designer's own 429 reads as the same limit message", () => {
    expect(designerRefusal({ limit: "hour", count: 30 })).toBe(overLimit(30, 0, 80));
    expect(designerRefusal({ limit: "day", count: 80 })).toBe(overLimit(0, 80, 80));
  });
});

describe("the designer from the site", () => {
  let root = "";
  let server: Server;
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const seen: Array<{ token: string | undefined; body: unknown }> = [];
  let designer: typeof import("@/server/designer");

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "designs-"));
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        seen.push({ token: req.headers["x-designer-token"] as string | undefined, body: raw ? JSON.parse(raw) : null });
        res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    vi.stubEnv("DATA_DIR", path.join(root, "data"));
    vi.stubEnv("DESIGNER_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    vi.stubEnv("DESIGNER_TOKEN", TOKEN);
    vi.stubEnv("ADMIN_DISCORD_ID", "111111111111111111");
    vi.resetModules();
    designer = await import("@/server/designer");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });

  it("is the owner's alone on the plan's login", () => {
    expect(designer.isDesignerOwner({ role: "ADMIN", discordId: "111111111111111111" })).toBe(true);
    expect(designer.isDesignerOwner({ role: "ADMIN", discordId: "222222222222222222" })).toBe(false);
    expect(designer.isDesignerOwner({ role: "PLAYER", discordId: "111111111111111111" })).toBe(false);
    expect(designer.isDesignerOwner({ role: "ADMIN", discordId: null })).toBe(false);
  });
  it("calls the designer with the token and reads its answer, or says in words what went wrong", async () => {
    reply = { status: 200, body: { text: "{}", ms: 1500, usage: { input: 2, cacheWrite: 3, cacheRead: 4, output: 5 } } };
    expect(await designer.askDesigner({ name: "gate", ask: "a gate", recipe: null })).toEqual({ ok: true, text: "{}", ms: 1500, tokens: { input: 2, cacheWrite: 3, cacheRead: 4, output: 5 } });
    expect(seen.at(-1)).toEqual({ token: TOKEN, body: { name: "gate", ask: "a gate", recipe: null } });
    reply = { status: 409, body: { error: "busy" } };
    expect(await designer.askDesigner({ name: "gate", ask: "a gate", recipe: null })).toEqual({ ok: false, busy: true, error: "The designer is busy with another build. Try again in a few minutes." });
    reply = { status: 401, body: { error: "no" } };
    expect(await designer.askDesigner({ name: "gate", ask: "a gate", recipe: null })).toMatchObject({ ok: false, error: expect.stringContaining("DESIGNER_TOKEN") });
    reply = { status: 502, body: { error: "the designer answered with an error: Not logged in" } };
    expect(await designer.askDesigner({ name: "gate", ask: "a gate", recipe: null })).toEqual({ ok: false, error: "The designer failed: the designer answered with an error: Not logged in" });
  });
  it("health: signed out is not well", async () => {
    reply = { status: 200, body: { cli: "2.0.0", signedIn: false, busy: false } };
    expect(await designer.designerHealth()).toEqual({ ok: false, signedIn: false, cli: "2.0.0", busy: false });
    reply = { status: 200, body: { cli: "2.0.0", signedIn: true, busy: true } };
    expect(await designer.designerHealth()).toEqual({ ok: true, signedIn: true, cli: "2.0.0", busy: true });
  });
  it("keeps designs as files under data/builds/designs, which Build never reads", async () => {
    const d = withVersion(null, "gate", { at: "2026-10-07T08:00:00.000Z", ask: "a gate", say: "A gate.", recipe: { ...GATE, name: "gate" } as never, ms: 1, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, fixed: false });
    await designer.writeDesign(d);
    expect(await designer.readDesign("gate")).toEqual(d);
    expect(await designer.readDesign("../gate")).toBeNull();
    expect(await designer.listDesigns()).toEqual([summary(d)]);
    expect(designer.DESIGNS_DIR).toBe(path.join(root, "data", "builds", "designs"));
  });
});

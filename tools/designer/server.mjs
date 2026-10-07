// docs/39 Step 1: the build designer's container. One file and no dependencies, run by the stock node image as the
// designer's own host user. It runs the host's CLI once per request, with fixed instructions and no tools, and hands
// back the text. Nothing from a request becomes an argument: the command, the flags and the instructions are fixed
// here, and the request's words go to the CLI on stdin only.
//
//   POST /design  {name, ask, recipe?}   one call at a time; a second caller gets 409 at once; 429 past the limits
//   GET  /health                         {cli, signedIn, busy}, without calling the model
//
// The limits (30 calls in an hour, DESIGNER_DAILY in a day) are kept here as well as in web: web holds the token, so
// its own count could be skipped by anyone who broke into web. Counted in memory: a restart starts the count again.
//
// Both want the header x-designer-token. Listens on 4100 on the `internal` network; no port is published.
//
// The instructions are tools/designer/instructions.md, beside this file: web cannot write there. The block list comes
// from modpack/designer/blocks.json, which web can write, so only ids, kinds and property values of the plain shape a
// block id has get into the prompt; anything else in that file is dropped.

import { execFile, spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LIMITS = { ask: 2000, recipe: 64 * 1024, body: 80 * 1024, output: 2 * 1024 * 1024, timeoutMs: 600_000 };
export const RATE = { hourly: 30, daily: 80 };
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The calls that reached the model in the last day. `over()` says which limit is used up, with the count, or null;
 * `take()` counts one call. The windows roll, as web's count does (designCalls in apps/web/src/server/designer.ts).
 */
export function callLimiter({ hourly = RATE.hourly, daily = RATE.daily, now = () => Date.now() } = {}) {
  let calls = [];
  return {
    over() {
      const t = now();
      calls = calls.filter((x) => t - x < DAY_MS);
      if (calls.length >= daily) return { limit: "day", count: calls.length };
      const hour = calls.filter((x) => t - x < HOUR_MS).length;
      if (hour >= hourly) return { limit: "hour", count: hour };
      return null;
    },
    take() {
      calls.push(now());
    },
  };
}

const NAME = /^[a-z0-9_]{2,24}$/;
const ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const WORD = /^[a-z0-9_]{1,24}$/;

/**
 * The flags every call gets: JSON out, no tools, no session kept on disk, no MCP servers, no slash commands, and the
 * most thought before it answers (docs/40 3a: the highest effort the CLI has).
 */
export function designerArgs(model, prompt) {
  return ["-p", "--output-format", "json", "--model", model, "--effort", "max", "--system-prompt", prompt, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"];
}

const WHAT = {
  "": "Full blocks (no properties)",
  stairs: "Stairs (facing, half; the stairs step sets facing itself)",
  slab: "Slabs (type)",
  axis: "Logs and pillars (axis)",
  wall: "Walls (they join up by themselves)",
  fence: "Fences (they join up by themselves)",
  pane: "Panes and bars (they join up by themselves)",
  lantern: "Lanterns (hanging)",
  wall_torch: "Torches on a wall (facing: the direction the torch points away from its wall)",
  leaves: "Leaves (they never decay)",
  carpet: "Carpets (a thin layer on a floor)",
  small: "Small things: pots, cushions, small tables (no properties)",
  candle: "Candles (candles: how many on the block; lit)",
  trapdoor: "Trapdoors: shutters, table tops, low shelves (facing, half, open)",
  door: "Doors: two blocks, the lower half and the upper half on it, with the same facing and hinge",
  facing: "Workstations and ladders (facing)",
  campfire: "Campfires: a hearth (facing, lit)",
  furniture: "Furniture (facing: the way a chair or a sofa faces; legs, joins and shapes are set by the game)",
  shutter: "Window shutters (facing, open, hinge)",
  seat: "Chairs, benches and side tables with a cushion (facing; color: the cushion, none for bare wood)",
  couch: "Couches (facing, color; they join up by themselves)",
  cloth: "Tables with a cloth (color, none for bare wood; they join up by themselves)",
  fancy_bed: "Beds: two blocks, the foot and the head next to it in the direction it faces, with the same facing and color",
  corner_trim: "Corner trims (facing; half: bottom on a floor, top under a ceiling; trim: how thick)",
  pillar_trim: "Pillar trims (face: floor, wall or ceiling; facing; trim: how thick)",
  curtain: "Curtains (facing, open)",
  lamp: "Lamps (facing: up on a floor, or the side it hangs from; lit)",
};

/** The block list as the designer reads it: the same text as blockListText in packages/modpack/src/design.ts. */
export function blockListText(list) {
  const kinds = list && typeof list.kinds === "object" && list.kinds ? list.kinds : {};
  const by = new Map();
  for (const b of Array.isArray(list?.blocks) ? list.blocks : []) {
    const id = typeof b?.id === "string" ? b.id : "";
    const kind = typeof b?.kind === "string" ? b.kind : "";
    if (!ID.test(id) || (kind && (!WORD.test(kind) || !(kind in WHAT)))) continue;
    by.set(kind, [...(by.get(kind) ?? []), id]);
  }
  const lines = ["## Blocks you may use", ""];
  for (const [k, ids] of by) {
    const props = kinds[k]?.props;
    const shown = props && typeof props === "object"
      ? Object.entries(props).filter(([p, v]) => WORD.test(p) && Array.isArray(v) && v.every((x) => typeof x === "string" && WORD.test(x)))
      : [];
    lines.push(`${WHAT[k]}${shown.length ? `: ${shown.map(([p, v]) => `${p}=${v.join("|")}`).join(", ")}` : ""}`);
    lines.push(ids.join(", "), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** The whole system prompt, read afresh for each call so a pull of new instructions needs no restart. */
export async function systemPrompt(dataDir, instructionsFile = path.join(HERE, "instructions.md")) {
  const instructions = await readFile(instructionsFile, "utf8");
  const blocks = JSON.parse(await readFile(path.join(dataDir, "blocks.json"), "utf8"));
  return `${instructions.trimEnd()}\n\n${blockListText(blocks)}`;
}

/** What the CLI reads on stdin: a new build, or a change to the recipe it is given. */
export function userMessage({ name, ask, recipe }) {
  if (recipe) return `Change this build. Keep its name "${name}". Its current recipe:\n${JSON.stringify(recipe)}\n\nWhat the admin wants changed:\n${ask}\n`;
  return `Design a new build named "${name}".\n\nWhat the admin wants:\n${ask}\n`;
}

/** The request's body checked: a name, the admin's words, and the current recipe when it is a change. */
export function checkRequest(body) {
  if (!body || typeof body !== "object") return { error: "the body is not a JSON object" };
  const { name, ask, recipe } = body;
  if (typeof name !== "string" || !NAME.test(name)) return { error: "name: a-z, 0-9 and _, 2 to 24 characters" };
  if (typeof ask !== "string" || !ask.trim()) return { error: "ask: say what to build or change" };
  if (ask.length > LIMITS.ask) return { error: `ask: at most ${LIMITS.ask} characters` };
  if (recipe !== undefined && recipe !== null) {
    if (typeof recipe !== "object" || Array.isArray(recipe)) return { error: "recipe: an object" };
    if (JSON.stringify(recipe).length > LIMITS.recipe) return { error: `recipe: at most ${LIMITS.recipe / 1024} KB` };
  }
  return { name, ask: ask.trim(), recipe: recipe ?? null };
}

/** One run of the CLI: the message on stdin, its JSON read back. Resolves {text, ms, usage} or {error}, never rejects. */
export function runDesigner({ cmd, args, input, env, cwd = "/tmp", timeoutMs = LIMITS.timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    let err = "";
    let over = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ error: `the command did not start: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length + d.length > LIMITS.output) {
        over = true;
        child.kill("SIGKILL");
      } else out += d;
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-2000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: `the command did not start: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ error: `the designer took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped` });
      if (over) return resolve({ error: "the designer's answer was larger than 2 MB" });
      let v;
      try {
        v = JSON.parse(out);
      } catch {
        return resolve({ error: code === 0 ? "the command's output was not JSON" : `the command stopped (exit ${code}): ${err.trim() || out.trim().slice(0, 500)}` });
      }
      if (v.is_error || typeof v.result !== "string") return resolve({ error: `the designer answered with an error: ${String(v.result ?? v.subtype ?? "unknown").slice(0, 500)}` });
      const u = v.usage ?? {};
      const n = (x) => (Number.isFinite(x) ? x : 0);
      resolve({
        text: v.result,
        ms: Number.isFinite(v.duration_ms) ? v.duration_ms : Date.now() - started,
        usage: { input: n(u.input_tokens), cacheWrite: n(u.cache_creation_input_tokens), cacheRead: n(u.cache_read_input_tokens), output: n(u.output_tokens) },
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const sameToken = (given, token) => {
  if (typeof given !== "string" || token.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The request handler. `run` is runDesigner (a stub in tests). `childEnv` is all the CLI gets of the environment:
 * HOME, PATH and DISABLE_AUTOUPDATER, never the token.
 */
export function createHandler({ token, cmd, model, dataDir, credentials, childEnv, run = runDesigner, instructionsFile, limiter = callLimiter() }) {
  let busy = false;
  let version = { at: 0, value: null };
  const cliVersion = () => {
    if (Date.now() - version.at < 600_000) return Promise.resolve(version.value);
    return new Promise((resolve) => {
      execFile(cmd, ["--version"], { env: childEnv, cwd: "/tmp", timeout: 10_000 }, (e, stdout) => {
        const value = e ? null : String(stdout).trim().split("\n")[0].slice(0, 60) || null;
        version = { at: Date.now(), value };
        resolve(value);
      });
    });
  };
  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  return async (req, res) => {
    if (!sameToken(req.headers["x-designer-token"], token)) return send(res, 401, { error: "no" });
    const url = new URL(req.url ?? "/", "http://designer");
    if (req.method === "GET" && url.pathname === "/health") {
      const signedIn = credentials ? await access(credentials).then(() => true, () => false) : null;
      return send(res, 200, { cli: await cliVersion(), signedIn, busy });
    }
    if (req.method !== "POST" || url.pathname !== "/design") return send(res, 404, { error: "not found" });
    if (busy) {
      req.resume();
      return send(res, 409, { error: "busy" });
    }
    busy = true;
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > LIMITS.body) return send(res, 413, { error: "the request is too large" });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "the body is not JSON" });
      }
      const checked = checkRequest(body);
      if (checked.error) return send(res, 400, { error: checked.error });
      let prompt;
      try {
        prompt = await systemPrompt(dataDir, instructionsFile);
      } catch (e) {
        return send(res, 500, { error: `the instructions could not be read: ${e instanceof Error ? e.message : String(e)}` });
      }
      const over = limiter.over();
      if (over) return send(res, 429, { error: `the most calls for ${over.limit === "day" ? "a day" : "an hour"}`, ...over });
      limiter.take();
      const r = await run({ cmd, args: designerArgs(model, prompt), input: userMessage(checked), env: childEnv });
      return send(res, r.error ? 502 : 200, r);
    } finally {
      busy = false;
    }
  };
}

async function main() {
  const e = process.env;
  const token = e.DESIGNER_TOKEN ?? "";
  if (token.length < 32 || !e.DESIGNER_CMD || !e.DESIGNER_MODEL) {
    console.error("designer: DESIGNER_TOKEN (32 characters or more), DESIGNER_CMD and DESIGNER_MODEL must be set in deploy/.env");
    process.exit(1);
  }
  const handler = createHandler({
    token,
    cmd: e.DESIGNER_CMD,
    model: e.DESIGNER_MODEL,
    dataDir: e.DESIGNER_DATA ?? "/designer-data",
    credentials: e.DESIGNER_CREDENTIALS || null,
    childEnv: { HOME: e.HOME ?? "/tmp", PATH: e.PATH ?? "/usr/bin:/bin", DISABLE_AUTOUPDATER: "1", LANG: "C.UTF-8" },
    limiter: callLimiter({ daily: Math.max(1, Number.parseInt(e.DESIGNER_DAILY ?? "", 10) || RATE.daily) }),
  });
  createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("designer:", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  }).listen(4100, "0.0.0.0", () => console.log("designer: listening on 4100"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

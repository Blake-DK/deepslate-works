// docs/16 §4: every regex that reads the Minecraft console lives in this file, with tests against lines
// captured from the real server (tests/parse.test.ts).
//
// Two shapes reach us. The log file writes
//   [29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.756s)! ...
// and AMP's console entries carry the message in `Contents` with the thread and level in `Source` and a
// `Type` of their own ("Console", "Chat", ...). Both are reduced to the bare message first; the patterns
// below are anchored to the start of that message, so nothing a player types in chat can pass for a join.

import { parseSnbt } from "./snbt.js";
import type { Nbt } from "../players/nbt.js";

export type Meta = { source?: string | null; type?: string | null };
export type Level = "INFO" | "WARN" | "ERROR" | "FATAL" | "DEBUG" | "TRACE";

export type GameEvent =
  | { type: "uuid"; name: string; uuid: string }
  | { type: "join"; name: string; ip: string | null }
  | { type: "leave"; name: string; reason: string | null }
  // 2.1.0: NeoForge refused them at the handshake because their game lacks a mod the server needs (they never joined)
  | { type: "refused"; name: string; uuid: string | null; reason: string; mod: string | null; channel: string | null }
  | { type: "list"; online: number; max: number; names: string[] }
  | { type: "chat"; name: string; text: string }
  | { type: "death"; name: string; text: string }
  | { type: "advancement"; name: string; how: "advancement" | "challenge" | "goal"; title: string }
  | { type: "started"; seconds: number }
  | { type: "stopping" }
  | { type: "ping"; name: string; ms: number }
  // `neoforge tps`: one line per dimension, then "Overall" (the Admin → Server → Settings card's TPS and MSPT)
  | { type: "tps"; scope: string; tps: number; mspt: number }
  | { type: "pregen"; what: "running"; world: string; chunks: number; percent: number; eta: string | null; rate: number | null }
  | { type: "pregen"; what: "started" | "continued" | "paused" | "stopped" | "cancelled"; world: string | null }
  | { type: "pregen"; what: "finished"; world: string; chunks: number | null }
  // "No tasks to continue.": chunky's answer to `chunky continue` when it has nothing left (2026-09-30 06:50, after
  // an api restart the portal had forgotten that the area was finished and asked again and again)
  | { type: "pregen"; what: "none-left" }
  | { type: "pos"; name: string; x: number; y: number; z: number }
  | { type: "dimension"; name: string; dimension: string }
  // `data get entity <name>` (docs/13 §13, the admin's inventory editor): the whole player, read like a save file
  | { type: "entitydata"; name: string; data: { [key: string]: Nbt } }
  | { type: "map"; line: MapLine }
  | { type: "problem"; level: "WARN" | "ERROR"; text: string; logger: string | null };

/**
 * One line of what BlueMap answers to `bluemap` ("BlueMap Status >") and `bluemap maps` ("BlueMap Maps >").
 * The lines of a map follow its name; status/map.ts puts them together.
 */
export type MapLine =
  | { what: "status" | "maps" } // the heading of an answer
  | { what: "threads"; state: "running" | "idle" | "stopped" | "paused" }
  | { what: "current"; map: string; doing: "updated" | "purged" }
  | { what: "progress"; percent: number }
  | { what: "remaining"; text: string }
  | { what: "map"; map: string; icon: "updated" | "frozen" | "pending" | "rendering" }
  | { what: "rendering"; percent: number; purge: boolean } // purge: what is in hand is the deleting of the map
  | { what: "pending"; tasks: number }
  | { what: "frozen" }
  | { what: "said"; threads: "running" | "stopped" }
  | { what: "loading" } // BlueMap is not up yet and has done nothing of what it was asked
  | { what: "other" }; // a line of an answer that says nothing the portal uses

const NAME = "[A-Za-z0-9_]{3,16}";
const PREFIX = new RegExp(
  "^\\s*" +
    "(?:\\[(?:\\d{1,2}[A-Za-z]{3}\\d{4} )?\\d{1,2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\]\\s*)?" + // [19:49:10] or [29Sep2026 03:46:07.132]
    "(?:\\[([^\\]/]+)/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\\]\\s*)?" + // [Server thread/INFO]
    "(?:\\[([^\\]\\s]*[/.][^\\]\\s]*)\\]\\s*)?" + // [net.minecraft.server.MinecraftServer/] or [minecraft/PlayerList]
    ":?\\s*",
);

export type Reduced = { message: string; level: Level | null; logger: string | null; thread: string | null };

export function reduce(text: string, meta: Meta = {}): Reduced {
  const m = PREFIX.exec(text);
  let level = (m?.[2] as Level | undefined) ?? null;
  let thread = m?.[1] ?? null;
  if (!level && meta.source) {
    const s = /^(.*)\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)$/.exec(meta.source);
    if (s) {
      thread = s[1] ?? null;
      level = s[2] as Level;
    }
  }
  return { message: text.slice(m?.[0].length ?? 0).replace(/\s+$/, ""), level, logger: m?.[3]?.replace(/\/$/, "") || null, thread };
}

/**
 * 2.1.0 (kanefinch, 2026-10-01): "Channel of mod 'Timeless & Classics Guns: Zero' failed to connect: This channel is
 * missing on the client side, but required on the server (tacz:acknowledge) [+1 more]". NeoForge's own words, or its
 * translation key when the server has no text for it. Null when the reason is anything else.
 */
export function refusedFor(reason: string): { mod: string | null; channel: string | null } | null {
  if (!/missing on the client|neoforge\.network\.negotiation|Channel of mod .* failed to connect|mods? .*(?:missing|not installed) on the client/i.test(reason)) return null;
  const mod = /Channel of mod '([^']{1,80})'/.exec(reason)?.[1] ?? null;
  const channel = /\(([a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64})\)/.exec(reason)?.[1] ?? null;
  return { mod, channel };
}

const RE = {
  uuid: new RegExp(`^UUID of player (${NAME}) is ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`, "i"),
  login: new RegExp(`^(${NAME})\\[/?((?:\\[[^\\]]*\\])?[^\\]]*)\\] logged in with entity id \\d+`),
  joined: new RegExp(`^(${NAME}) joined the game$`),
  left: new RegExp(`^(${NAME}) left the game$`),
  lost: new RegExp(`^(${NAME}) lost connection: (.*)$`),
  // during the handshake (configuration phase) Minecraft writes the UUID too: "kanefinch (0f…) lost connection: …"
  lostConfig: new RegExp(`^(${NAME}) \\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\) lost connection: (.*)$`, "i"),
  list: /^There are (\d+) of a max of (\d+) players online:\s*(.*)$/,
  chat: new RegExp(`^(?:\\[Not Secure\\] )?<(${NAME})> (.*)$`),
  advancement: new RegExp(`^(${NAME}) has (made the advancement|completed the challenge|reached the goal) \\[(.+)\\]$`),
  started: /^Done \(([\d.]+)s\)!/,
  // "Stopping the server" (the stop command's answer, what AMP's own stop and its sleep write) and "Stopping server"
  // (Minecraft, a moment later). Either one means a clean stop.
  stopping: /^Stopping (?:the )?server$/,
  // chunky. AMP hands the lines over without "[Chunky] " in front; the log file has it.
  pregenRunning: /^(?:\[Chunky\] )?Task running for ([a-z0-9_.:\/-]{1,80})\. Processed: (\d+) chunks \(([\d.]+)%\)(?:, ETA: ([\d:]+))?(?:, Rate: ([\d.]+) cps)?/,
  pregenNoneLeft: /^(?:\[Chunky\] )?No tasks to continue\.$/,
  pregenFinished: /^(?:\[Chunky\] )?Task finished for ([a-z0-9_.:\/-]{1,80})\.(?: Processed: (\d+) chunks)?/,
  pregenOther: /^(?:\[Chunky\] )?Task (started|continuing|continued|paused|stopped|cancelled|canceled)\b(?: (?:in|for) ([a-z0-9_.:\/-]{1,80}?))?[. ]/,
  // `data get entity <name> Pos` and `... Dimension`, asked before a member is moved to the entrance room
  entityData: new RegExp(`^(${NAME}) has the following entity data: (\\{.*\\})$`),
  gave: new RegExp(`^Gave (\\d+) \\[(.+)\\] to (${NAME})$`),
  replaced: new RegExp(`^Replaced a slot on (${NAME}) with \\[(.+)\\]$`),
  pos: new RegExp(`^(${NAME}) has the following entity data: \\[(-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d, (-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d, (-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d\\]$`),
  dimension: new RegExp(`^(${NAME}) has the following entity data: "([a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64})"$`),
  // spark, `spark ping --player Bramble09`. Its source has "[⚡] Player Bramble09 has 23 ms ping."; the console of
  // this server writes "[⚡]: Player bramble09 has 116 ms ping." (2026-09-29, the first player on with spark asked).
  sparkPing: new RegExp(`^(?:\\[\u26a1\\]:?\\s*)?Player (${NAME}) has (\\d{1,6}) ms ping\\.$`),
  // NeoForge 1.21.1, `neoforge tps` (lang key commands.neoforge.tps.overall / .dimension): "Overall: 20.000 TPS
  // (1.234 ms/tick)", "minecraft:overworld: 20.000 TPS (0.812 ms/tick)". DecimalFormat may write a comma.
  tps: /^(Overall|[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}|[A-Za-z][\w ]{0,40}): (\d{1,3}[.,]\d{1,3}) TPS \((\d{1,6}[.,]\d{1,3}) ms\/tick\)$/,
  // TabTPS, `pingall`: " - Bramble09: 23ms", one line for each player, then "Average ping: 23ms (1 player)"
  ping: new RegExp(`^-\\s+(${NAME}):\\s+(\\d{1,6})\\s?ms$`),
  death: new RegExp(
    `^(${NAME}) (` +
      "was (?:slain|shot|killed|blown up|fireballed|pummeled|impaled|squashed|skewered|struck by lightning|burned|burnt|frozen|stung|poked|pricked|squished|doomed|obliterated|roasted|sonically|skewered)\\b.*" +
      "|fell (?:from|off|out|while|into|too)\\b.*" +
      "|hit the ground too hard.*|drowned.*|died.*|blew up.*|burned to death.*|went up in flames.*|walked into .*" +
      "|tried to swim in lava.*|suffocated in a wall.*|starved to death.*|froze to death.*|withered away.*" +
      "|experienced kinetic energy.*|went off with a bang.*|left the confines of this world.*|didn't want to live .*" +
      "|discovered the floor was lava.*|was killed.*" +
      ")$",
  ),
};

// BlueMap 5.7, from its source (common/.../commands/StatusCommand.java, MapListCommand.java, TextFormat.java)
// and from the server's console on 2026-09-29. The signs in front are BlueMap's: \u2714 updated, \u2744 frozen,
// \u231b pending, \u26cf in hand, \u274c stopped; \u251c \u2502 \u2514 in front of the lines under a heading.
const MAP_ID = "[a-z0-9_-]{1,40}";
const ICONS: Record<string, "updated" | "frozen" | "pending" | "rendering"> = { "\u2714": "updated", "\u2744": "frozen", "\u231b": "pending", "\u26cf": "rendering" };
const MAP = {
  heading: /^BlueMap (Status|Maps) >$/,
  threadsStopped: /^\u274c render-threads are stopped$/,
  threadsPaused: /^\u231b render-threads are paused$/,
  threads: /^\u2714 \d+ render-threads? (?:is|are) (running|idle)$/,
  current: new RegExp(`^\u26cf map (${MAP_ID}) is currently being (updated|purged)$`),
  detail: /^[\u251c\u2502\u2514] ?(.*)$/,
  progress: /^progress: ([\d.]+)%$/,
  remaining: /^remaining time: (.{1,60})$/,
  rendering: /^(is currently being updated|is currently being purged|has a running task): ([\d.]+)%$/,
  pending: /^has (\d+) pending tasks?$/,
  frozen: /^is frozen$/,
  summary: /^[\u2714\u2744\u231b] (?:map \S+ (?:has pending updates|is updated|is frozen)|\d+ maps (?:have pending updates|are updated|are frozen))$/,
  map: new RegExp(`^([\u2714\u2744\u231b\u26cf]) (${MAP_ID})$`),
  said: /^[\u26cf\u274c] Render-Threads are now (running|stopped)$/,
  loading: /^\u231b BlueMap is still loading!$/,
  asked: /^(?:Creating update-tasks \.\.\.|Created new update-task for map \S+|Use \/bluemap to see the progress|Scheduled a new task to purge map \S+|BlueMap will automatically start rendering the map again once the purge is done|If you don't want this, use \/bluemap freeze \S+ before purging)$/,
};

/** Pure: one line of BlueMap's answers, or null when the line is none of them. */
export function parseMapLine(message: string): MapLine | null {
  const t = message.trim();
  let m: RegExpExecArray | null;
  if ((m = MAP.heading.exec(t))) return { what: m[1] === "Status" ? "status" : "maps" };
  if (MAP.threadsStopped.test(t)) return { what: "threads", state: "stopped" };
  if (MAP.threadsPaused.test(t)) return { what: "threads", state: "paused" };
  if ((m = MAP.threads.exec(t))) return { what: "threads", state: m[1] as "running" | "idle" };
  if ((m = MAP.current.exec(t))) return { what: "current", map: m[1]!, doing: m[2] as "updated" | "purged" };
  if ((m = MAP.said.exec(t))) return { what: "said", threads: m[1] as "running" | "stopped" };
  if (MAP.loading.test(t)) return { what: "loading" };
  if (MAP.summary.test(t) || MAP.asked.test(t)) return { what: "other" };
  if ((m = MAP.map.exec(t))) return { what: "map", map: m[2]!, icon: ICONS[m[1]!]! };
  if ((m = MAP.detail.exec(t))) {
    const d = m[1]!.trim();
    let n: RegExpExecArray | null;
    if ((n = MAP.progress.exec(d))) return { what: "progress", percent: Number(n[1]) };
    if ((n = MAP.remaining.exec(d))) return { what: "remaining", text: n[1]! };
    if ((n = MAP.rendering.exec(d))) return { what: "rendering", percent: Number(n[2]), purge: n[1] === "is currently being purged" };
    if ((n = MAP.pending.exec(d))) return { what: "pending", tasks: Number(n[1]) };
    if (MAP.frozen.test(d)) return { what: "frozen" };
    return { what: "other" };
  }
  return null;
}

/** What BlueMap answers when the portal asks where the render stands. Read, then kept out of the console page while the portal is the one asking. */
export function isMapChatter(text: string): boolean {
  const { message } = reduce(text);
  return message.trim() === "" || parseMapLine(message) !== null;
}

/** What a round of `pingall` prints. Read for the numbers, then kept out of the console page: it comes every 15 s. */
/** A whole player as `data get entity` prints it: long, and for the inventory editor, not for the console page. */
export function isEntityDump(text: string): boolean {
  return / has the following entity data: \{/.test(text);
}

export type InvReply = { ok: true; what: "gave" | "replaced"; item: string } | { ok: false; message: string; maxStack?: number };

// What the server answers to `give` and `item replace` (docs/13 §13), and the refusals that can come back instead.
const INV_ERRORS: RegExp[] = [
  /^Unknown item '[^']+'/,
  /^.+ can only stack up to \d+$/,
  /^Malformed .+/,
  /^Unknown (?:item )?component '[^']+'/,
  /^Expected .+ at position \d+/,
  /^Invalid .+/,
  /^No player was found$/,
  /^No entity was found$/,
  /^The target does not have slot .+$/,
  /^Unknown or incomplete command/,
  /^Incorrect argument for command/,
];

/** The server's answer to a change made to `name`'s inventory, or null when the line is about something else. */
export function invReply(message: string, name: string): InvReply | null {
  const t = message.trim();
  let m: RegExpExecArray | null;
  if ((m = RE.gave.exec(t)) && m[3]!.toLowerCase() === name.toLowerCase()) return { ok: true, what: "gave", item: m[2]! };
  if ((m = RE.replaced.exec(t)) && m[1]!.toLowerCase() === name.toLowerCase()) return { ok: true, what: "replaced", item: m[2]! };
  if (INV_ERRORS.some((re) => re.test(t))) {
    const over = /can only stack up to (\d+)$/.exec(t);
    return over ? { ok: false, message: t, maxStack: Number(over[1]) } : { ok: false, message: t };
  }
  return null;
}

// Clearing items on the ground and the entity counts (status/ground.ts). The answers to `execute if entity …`,
// `function …` and `kill …` as the server prints them to the console (en_us, 1.21.1).
export type CountReply = { ok: true; count: number } | { ok: false; message: string };
const COUNT_ERRORS: RegExp[] = [/^Unknown (?:entity )?(?:type )?tag '[^']+'/i, /^Unknown entity type tag/i, /^Unknown or incomplete command/, /^Incorrect argument for command/, /^Invalid .+/, /^Unknown objective '[^']+'/, /<--\[HERE\]$/];

/** The server's answer to `execute if entity <selector>`, or null when the line is about something else. */
export function countReply(message: string): CountReply | null {
  const t = message.trim();
  const m = /^Test passed, count: (\d+)$/.exec(t);
  if (m) return { ok: true, count: Number(m[1]) };
  if (t === "Test failed") return { ok: true, count: 0 };
  if (COUNT_ERRORS.some((re) => re.test(t))) return { ok: false, message: t };
  return null;
}

/** The answer to `kill <selector>`: how many went. "Killed Cobblestone" is one; "No entity was found" none. */
export function killReply(message: string): number | null {
  const t = message.trim();
  const m = /^Killed (\d+) entities$/.exec(t);
  if (m) return Number(m[1]);
  if (t === "No entity was found") return 0;
  if (/^Killed \S.*$/.test(t)) return 1;
  return null;
}

/** The answer to `function deepslate:ground/…`: false when the datapack is not loaded (yet). */
export function functionReply(message: string, name: string): boolean | null {
  const t = message.trim();
  if (t.startsWith(`Unknown function ${name}`) || (t.includes(name) && /^Unknown/.test(t))) return false;
  if (t.includes(name) && /^(?:Executed|Running|Function)/.test(t)) return true;
  return null;
}

/** What the portal's own counting leaves in the console; kept off the console page while it counts. */
export function isCountChatter(text: string): boolean {
  const t = reduce(text).message.trim();
  return /^Test passed, count: \d+$/.test(t) || t === "Test failed" || /deepslate:ground\//.test(t);
}

/** An answer to `neoforge tps`. Kept off the console page only while the portal itself has just asked. */
export function isTpsLine(text: string): boolean {
  return RE.tps.test(reduce(text).message.trim());
}

export function isPingChatter(text: string): boolean {
  const { message } = reduce(text);
  const t = message.trim();
  return RE.sparkPing.test(t) || /^(?:\[\u26a1\]:?\s*)?Ping data is not available for '[A-Za-z0-9_]{3,16}'\.$/.test(t) || RE.ping.test(t) || /^Average ping: \d+\s?ms \(\d+ players?\)$/.test(t) || /^-* ?(?:\[?TabTPS\]? )?Player Pings ?-*$/.test(t) || /^-{6,}$/.test(t);
}

// Printed on every start by the mod loader and harmless; they would only bury the lines that matter.
const NOISE = [
  /^Reference map '.*refmap\.json' for .* could not be read/,
  /^Method overwrite conflict for /,
  /^Discarding @Unique public method \w+ in [\w.-]+\.mixins\.json:/, // Copycats+ at every start: a method Create already has (2026-09-30)
  /^Assets URL 'union:/,
  /^Failed to parse level-type /,
  /^Initial datapack load took /,
  /^Dedicated server took [\d.]+ seconds to load$/,
  /^Failed to load eula\.txt$/,
  /^\s*at [\w.$<>]+\(.*\)$/, // stack trace frames
  /^Caused by: /,
  /^\.\.\. \d+ more$/,
];

/** IP without the port, from "10.0.0.5:51234", "[2a01::1]:51234" or "local". */
export function ipOf(endpoint: string): string | null {
  const v6 = /^\[([0-9a-fA-F:.]+)\]:\d+$/.exec(endpoint);
  if (v6) return v6[1] ?? null;
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(endpoint);
  return v4 ? (v4[1] ?? null) : null;
}

/** For `raw`: the address is kept on the Session (30 days), never in the event log (180 days). */
export function redact(text: string): string {
  return text.replace(/\[\/?(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\]):\d+\]/g, "[address hidden]");
}

export function parse(text: string, meta: Meta = {}, isPlayer?: (name: string) => boolean): GameEvent[] {
  const { message, level, logger } = reduce(text, meta);
  if (!message) return [];
  // AMP marks chat itself and puts the speaker in Source.
  if (meta.type && /^chat$/i.test(meta.type) && meta.source && new RegExp(`^${NAME}$`).test(meta.source)) {
    return [{ type: "chat", name: meta.source, text: message.replace(new RegExp(`^(?:\\[Not Secure\\] )?<${meta.source}> `), "") }];
  }
  let m: RegExpExecArray | null;
  if ((m = RE.chat.exec(message))) return [{ type: "chat", name: m[1]!, text: m[2]! }];
  if ((m = RE.pregenRunning.exec(message))) return [{ type: "pregen", what: "running", world: m[1]!, chunks: Number(m[2]), percent: Number(m[3]), eta: m[4] ?? null, rate: m[5] ? Number(m[5]) : null }];
  if (RE.pregenNoneLeft.test(message)) return [{ type: "pregen", what: "none-left" }];
  if ((m = RE.pregenFinished.exec(message))) return [{ type: "pregen", what: "finished", world: m[1]!, chunks: m[2] ? Number(m[2]) : null }];
  if ((m = RE.pregenOther.exec(message))) {
    const w = m[1]!;
    const what = w === "started" ? "started" : w === "paused" ? "paused" : w === "stopped" ? "stopped" : w.startsWith("cancel") ? "cancelled" : "continued";
    return [{ type: "pregen", what, world: m[2] ?? null }];
  }
  if (/^\[(?:Server|Rcon|[A-Za-z0-9_: ]{1,40})\] /.test(message)) return []; // `say` from the console or a command block
  const map = parseMapLine(message);
  if (map) return [{ type: "map", line: map }];
  if ((m = RE.uuid.exec(message))) return [{ type: "uuid", name: m[1]!, uuid: m[2]!.toLowerCase() }];
  if ((m = RE.login.exec(message))) return [{ type: "join", name: m[1]!, ip: ipOf(m[2]!) }];
  if ((m = RE.joined.exec(message))) return [{ type: "join", name: m[1]!, ip: null }];
  if ((m = RE.lostConfig.exec(message))) {
    const r = refusedFor(m[3]!);
    return r ? [{ type: "refused", name: m[1]!, uuid: m[2]!.toLowerCase(), reason: m[3]!, ...r }] : [{ type: "leave", name: m[1]!, reason: m[3]! }];
  }
  if ((m = RE.lost.exec(message))) {
    const r = refusedFor(m[2]!);
    return r ? [{ type: "refused", name: m[1]!, uuid: null, reason: m[2]!, ...r }, { type: "leave", name: m[1]!, reason: m[2]! }] : [{ type: "leave", name: m[1]!, reason: m[2]! }];
  }
  if ((m = RE.left.exec(message))) return [{ type: "leave", name: m[1]!, reason: null }];
  if ((m = RE.list.exec(message))) return [{ type: "list", online: Number(m[1]), max: Number(m[2]), names: m[3]!.split(",").map((s) => s.trim()).filter(Boolean) }];
  if ((m = RE.advancement.exec(message))) {
    const how = m[2] === "made the advancement" ? "advancement" : m[2] === "completed the challenge" ? "challenge" : "goal";
    return [{ type: "advancement", name: m[1]!, how, title: m[3]! }];
  }
  if ((m = RE.pos.exec(message))) {
    const [x, y, z] = [Number(m[2]), Number(m[3]), Number(m[4])];
    return [x, y, z].every(Number.isFinite) ? [{ type: "pos", name: m[1]!, x: x!, y: y!, z: z! }] : [];
  }
  if ((m = RE.dimension.exec(message))) return [{ type: "dimension", name: m[1]!, dimension: m[2]! }];
  if ((m = RE.entityData.exec(message))) {
    try {
      const data = parseSnbt(m[2]!);
      return data && typeof data === "object" && !Array.isArray(data) ? [{ type: "entitydata", name: m[1]!, data }] : [];
    } catch {
      return [];
    }
  }
  if ((m = RE.sparkPing.exec(message.trim()) ?? RE.ping.exec(message.trim()))) return [{ type: "ping", name: m[1]!, ms: Number(m[2]) }];
  if ((m = RE.tps.exec(message.trim()))) {
    const [tps, mspt] = [Number(m[2]!.replace(",", ".")), Number(m[3]!.replace(",", "."))];
    return Number.isFinite(tps) && Number.isFinite(mspt) ? [{ type: "tps", scope: m[1] === "Overall" ? "overall" : m[1]!, tps, mspt }] : [];
  }
  if ((m = RE.started.exec(message))) return [{ type: "started", seconds: Number(m[1]) }];
  if (RE.stopping.test(message)) return [{ type: "stopping" }];
  if ((m = RE.death.exec(message)) && (!isPlayer || isPlayer(m[1]!))) return [{ type: "death", name: m[1]!, text: m[2]! }];
  if ((level === "WARN" || level === "ERROR" || level === "FATAL") && !NOISE.some((n) => n.test(message))) {
    return [{ type: "problem", level: level === "WARN" ? "WARN" : "ERROR", text: message.slice(0, 500), logger }];
  }
  return [];
}

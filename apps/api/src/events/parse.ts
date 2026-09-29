// docs/16 §4: every regex that reads the Minecraft console lives in this file, with tests against lines
// captured from the real server (tests/parse.test.ts).
//
// Two shapes reach us. The log file writes
//   [29Sep2026 03:46:07.132] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.756s)! ...
// and AMP's console entries carry the message in `Contents` with the thread and level in `Source` and a
// `Type` of their own ("Console", "Chat", ...). Both are reduced to the bare message first; the patterns
// below are anchored to the start of that message, so nothing a player types in chat can pass for a join.

export type Meta = { source?: string | null; type?: string | null };
export type Level = "INFO" | "WARN" | "ERROR" | "FATAL" | "DEBUG" | "TRACE";

export type GameEvent =
  | { type: "uuid"; name: string; uuid: string }
  | { type: "join"; name: string; ip: string | null }
  | { type: "leave"; name: string; reason: string | null }
  | { type: "list"; online: number; max: number; names: string[] }
  | { type: "chat"; name: string; text: string }
  | { type: "death"; name: string; text: string }
  | { type: "advancement"; name: string; how: "advancement" | "challenge" | "goal"; title: string }
  | { type: "started"; seconds: number }
  | { type: "stopping" }
  | { type: "ping"; name: string; ms: number }
  | { type: "pos"; name: string; x: number; y: number; z: number }
  | { type: "dimension"; name: string; dimension: string }
  | { type: "problem"; level: "WARN" | "ERROR"; text: string; logger: string | null };

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

const RE = {
  uuid: new RegExp(`^UUID of player (${NAME}) is ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`, "i"),
  login: new RegExp(`^(${NAME})\\[/?((?:\\[[^\\]]*\\])?[^\\]]*)\\] logged in with entity id \\d+`),
  joined: new RegExp(`^(${NAME}) joined the game$`),
  left: new RegExp(`^(${NAME}) left the game$`),
  lost: new RegExp(`^(${NAME}) lost connection: (.*)$`),
  list: /^There are (\d+) of a max of (\d+) players online:\s*(.*)$/,
  chat: new RegExp(`^(?:\\[Not Secure\\] )?<(${NAME})> (.*)$`),
  advancement: new RegExp(`^(${NAME}) has (made the advancement|completed the challenge|reached the goal) \\[(.+)\\]$`),
  started: /^Done \(([\d.]+)s\)!/,
  stopping: /^Stopping server$/,
  // `data get entity <name> Pos` and `... Dimension`, asked before a member is moved to the entrance room
  pos: new RegExp(`^(${NAME}) has the following entity data: \\[(-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d, (-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d, (-?\\d+(?:\\.\\d+)?(?:E-?\\d+)?)d\\]$`),
  dimension: new RegExp(`^(${NAME}) has the following entity data: "([a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64})"$`),
  // spark, `spark ping --player Bramble09`: "[⚡] Player Bramble09 has 23 ms ping."
  sparkPing: new RegExp(`^(?:\\[\u26a1\\]\\s*)?Player (${NAME}) has (\\d{1,6}) ms ping\\.$`),
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

/** What a round of `pingall` prints. Read for the numbers, then kept out of the console page: it comes every 15 s. */
export function isPingChatter(text: string): boolean {
  const { message } = reduce(text);
  const t = message.trim();
  return RE.sparkPing.test(t) || /^(?:\[\u26a1\]\s*)?Ping data is not available for '[A-Za-z0-9_]{3,16}'\.$/.test(t) || RE.ping.test(t) || /^Average ping: \d+\s?ms \(\d+ players?\)$/.test(t) || /^-* ?(?:\[?TabTPS\]? )?Player Pings ?-*$/.test(t) || /^-{6,}$/.test(t);
}

// Printed on every start by the mod loader and harmless; they would only bury the lines that matter.
const NOISE = [
  /^Reference map '.*refmap\.json' for .* could not be read/,
  /^Method overwrite conflict for /,
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
  if (/^\[(?:Server|Rcon|[A-Za-z0-9_: ]{1,40})\] /.test(message)) return []; // `say` from the console or a command block
  if ((m = RE.uuid.exec(message))) return [{ type: "uuid", name: m[1]!, uuid: m[2]!.toLowerCase() }];
  if ((m = RE.login.exec(message))) return [{ type: "join", name: m[1]!, ip: ipOf(m[2]!) }];
  if ((m = RE.joined.exec(message))) return [{ type: "join", name: m[1]!, ip: null }];
  if ((m = RE.lost.exec(message))) return [{ type: "leave", name: m[1]!, reason: m[2]! }];
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
  if ((m = RE.sparkPing.exec(message.trim()) ?? RE.ping.exec(message.trim()))) return [{ type: "ping", name: m[1]!, ms: Number(m[2]) }];
  if ((m = RE.started.exec(message))) return [{ type: "started", seconds: Number(m[1]) }];
  if (RE.stopping.test(message)) return [{ type: "stopping" }];
  if ((m = RE.death.exec(message)) && (!isPlayer || isPlayer(m[1]!))) return [{ type: "death", name: m[1]!, text: m[2]! }];
  if ((level === "WARN" || level === "ERROR" || level === "FATAL") && !NOISE.some((n) => n.test(message))) {
    return [{ type: "problem", level: level === "WARN" ? "WARN" : "ERROR", text: message.slice(0, 500), logger }];
  }
  return [];
}

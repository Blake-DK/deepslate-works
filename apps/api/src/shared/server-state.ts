// Shared between web and api (identical file in both): the one set of words for how the server is (planner,
// 2026-09-30, docs/13 §12). Worked out in api from AMP's state plus what only the portal knows (can it reach AMP at
// all, is a wake running, did the server go down without a stop line); shown the same way everywhere.

export type ServerState = "online" | "asleep" | "waking" | "starting" | "stopping" | "restarting" | "off" | "crashed" | "unreachable";
export type Tone = "good" | "info" | "warn" | "neutral" | "bad";

export type StateInput = {
  /** AMP's state number; null when AMP gave none. */
  stateCode: number | null;
  /** false when the portal cannot reach AMP at all: tunnel down, instance not running, login refused. */
  reachable: boolean;
  /** a wake (from Play) is running and the server is not up yet */
  waking: boolean;
  /** the last time it went down, it went down without a stop line (events/recorder.ts decides) */
  crashed: boolean;
};

/** AMP's states (amp/client.ts, docs/08): 0 Stopped, 5/7/10 starting, 20 Running, 30 Restarting, 40 Stopping,
 * 45 PreparingForSleep, 50 Sleeping, 60 Waiting, 100 Failed, 200 Suspended, 250 Maintenance, 999/-1 unknown. */
export function serverState(i: StateInput): ServerState {
  const c = i.stateCode;
  if (!i.reachable || c === null || c === -1 || c === 999) return "unreachable";
  if (c === 20) return "online";
  if (i.waking) return "waking";
  if (c === 45 || c === 50) return "asleep";
  if (c === 5 || c === 7 || c === 10 || c === 60) return "starting";
  if (c === 30) return "restarting";
  if (c === 40) return "stopping";
  if (c === 100) return "crashed";
  if (c === 0 && i.crashed) return "crashed";
  return "off";
}

export const TONE: Record<ServerState, Tone> = {
  online: "good", asleep: "info", waking: "warn", starting: "warn", stopping: "warn", restarting: "warn", off: "neutral", crashed: "bad", unreachable: "bad",
};

/** Joinable: a member who connects gets in, or wakes it. Downloads and Play are open in these. */
export const JOINABLE: ReadonlySet<ServerState> = new Set(["online", "asleep", "waking"]);
/** Counted as "available" in the uptime figures. */
export const AVAILABLE: ReadonlySet<ServerState> = new Set(["online", "asleep", "waking"]);

export type Words = { players?: number; sleepInMin?: number | null; wakeLeftS?: number | null };

/** The short line: "Online, 3 playing", "Asleep, join to wake it", "Waking up… about 20 s". */
export function stateLine(s: ServerState, w: Words = {}): string {
  switch (s) {
    case "online":
      if (w.players && w.players > 0) return `Online, ${w.players} playing`;
      return `Online, nobody on${w.sleepInMin != null ? `, goes to sleep in about ${Math.max(1, Math.round(w.sleepInMin))} min` : ""}`;
    case "asleep": return "Asleep, join to wake it";
    case "waking": return w.wakeLeftS != null && w.wakeLeftS > 0 ? `Waking up… about ${Math.round(w.wakeLeftS)} s` : "Waking up…";
    case "starting": return "Starting…";
    case "stopping": return "Stopping…";
    case "restarting": return "Restarting…";
    case "off": return "Switched off";
    case "crashed": return "Crashed";
    case "unreachable": return "Can't reach the server";
  }
}

/** The one-word label for pills and the sidebar. */
export const STATE_LABEL: Record<ServerState, string> = {
  online: "Online", asleep: "Asleep", waking: "Waking up", starting: "Starting", stopping: "Stopping", restarting: "Restarting", off: "Switched off", crashed: "Crashed", unreachable: "Can't reach the server",
};

/** A sentence under the line, for players; admins get `adminHint` as well where it differs. */
export function stateHint(s: ServerState, admin: boolean): string {
  switch (s) {
    case "online": return "The server is up.";
    case "asleep": return "Nobody is on, so it is asleep. Press Play or join and it wakes up in about 30 seconds.";
    case "waking": return "Somebody pressed Play; it is waking up.";
    case "starting": return "The server is starting up. Give it a minute or two.";
    case "stopping": return "The server is shutting down.";
    case "restarting": return "The server is restarting. Give it a minute or two.";
    case "off": return admin ? "The server is switched off, so joining won't wake it. Start it here." : "The server is switched off. Ask Alex in Discord.";
    case "crashed": return admin ? "The server went down without shutting down first. Start it again, and look at the last console lines." : "The server has crashed. Ask Alex in Discord.";
    case "unreachable": return "The site can't reach the server's control panel right now, so it doesn't know whether the server is up.";
  }
}

// Wake on Play (docs/13 §12 B): a member-level start, only from Asleep.

/** How long a wake may take before it counts as failed, and the "ready in about" figure shown while it runs. */
export const WAKE_TIMEOUT_MS = 3 * 60_000;
export const WAKE_EXPECT_S = 30;

export type WakeDecision = "start" | "already" | "awake" | "not_open" | "not_member" | "off" | "crashed" | "unreachable" | "busy";

/** What a Play does to the server. Only "start" sends a start to AMP; everything else leaves it alone. */
export function wakeDecision(d: { member: boolean; openFor: boolean; state: ServerState }): WakeDecision {
  if (!d.member) return "not_member";
  if (!d.openFor) return "not_open";
  switch (d.state) {
    case "asleep": return "start";
    case "waking": return "already";
    case "online": return "awake";
    case "off": return "off";
    case "crashed": return "crashed";
    case "unreachable": return "unreachable";
    default: return "busy"; // starting, stopping, restarting: something else is already happening
  }
}

/** What the Play page and the script say about a wake. */
export const WAKE_TEXT = {
  waking: `Waking the server, ready in about ${WAKE_EXPECT_S} s`,
  ready: "Server ready",
  failed: "The server didn't wake up. Try again in a minute or tell Alex",
} as const;

/** The Play page's line for a wake: counts down from about 30 s, then "Server ready", or the failure. */
export function wakeLine(w: { phase: "idle" | "waking" | "ready" | "failed"; leftS: number | null }): string | null {
  if (w.phase === "waking") return w.leftS !== null && w.leftS > 0 && w.leftS < WAKE_EXPECT_S ? `Waking the server, ready in about ${w.leftS} s` : w.leftS === 0 ? "Waking the server, nearly there" : WAKE_TEXT.waking;
  if (w.phase === "ready") return WAKE_TEXT.ready;
  if (w.phase === "failed") return WAKE_TEXT.failed;
  return null;
}

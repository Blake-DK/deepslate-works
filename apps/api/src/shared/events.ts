// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/16 §4: what an audit entry becomes in the event log. Portal actions are ADMIN_ACTION or
// PLAYER_ACTION rows with the action's name, parameters and result in `meta`; a few have a kind of their own.

export const EVENT_KINDS = ["JOIN", "LEAVE", "DEATH", "CHAT", "ADVANCEMENT", "SERVER_START", "SERVER_STOP", "CRASH", "WARN", "ERROR", "ADMIN_ACTION", "PLAYER_ACTION", "LINK", "REVOKE", "SYNC", "BACKUP", "INSTALL", "JOIN_BLOCKED"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What players may see at /events. Everything else is for admins. */
export const PLAYER_KINDS: readonly EventKind[] = ["JOIN", "LEAVE", "DEATH", "ADVANCEMENT", "SERVER_START", "SERVER_STOP"];

export type Severity = "info" | "player" | "warning" | "error" | "admin";
export const SEVERITY: Record<EventKind, Severity> = {
  JOIN: "player", LEAVE: "player", DEATH: "player", CHAT: "player", ADVANCEMENT: "player",
  SERVER_START: "info", SERVER_STOP: "info", CRASH: "error", WARN: "warning", ERROR: "error",
  ADMIN_ACTION: "admin", PLAYER_ACTION: "player", LINK: "player", REVOKE: "admin", SYNC: "admin", BACKUP: "admin", INSTALL: "player", JOIN_BLOCKED: "warning",
};

export const KIND_LABEL: Record<EventKind, string> = {
  JOIN: "Joined", LEAVE: "Left", DEATH: "Death", CHAT: "Chat", ADVANCEMENT: "Advancement",
  SERVER_START: "Server started", SERVER_STOP: "Server stopped", CRASH: "Crash", WARN: "Warning", ERROR: "Error",
  ADMIN_ACTION: "Admin", PLAYER_ACTION: "Player", LINK: "Link", REVOKE: "Removed", SYNC: "Mod sync", BACKUP: "Backup", INSTALL: "Install", JOIN_BLOCKED: "Held at the door",
};

export type AuditResult = "OK" | "DENIED" | "FAILED" | "TIMEOUT";
export type Actor = { role: "ADMIN" | "PLAYER" | "system" | null; name: string | null };

/** Must agree with the CASE in prisma/migrations/0005_events_sessions_settings. */
export function kindOf(action: string, role: Actor["role"]): EventKind {
  if (action === "link.bind" || action === "link.release" || action === "limbo.held" || action === "limbo.kickIdle" || action === "limbo.kickIdlePlay" || action === "limbo.kickIdleClosed" || action === "join.ready") return "LINK";
  if (action === "player.revoke" || action === "user.remove" || action === "user.clearMinecraft") return "REVOKE";
  if (action.startsWith("modpack.sync")) return "SYNC";
  if (action === "server.backup") return "BACKUP";
  if (action === "installer.report") return "INSTALL";
  if (action === "join.blocked") return "JOIN_BLOCKED";
  return role === "ADMIN" || role === "system" ? "ADMIN_ACTION" : "PLAYER_ACTION";
}

type P = Record<string, unknown>;
const s = (v: unknown, fallback = "?") => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fallback);

const PHRASES: Record<string, string | ((p: P) => string)> = {
  "auth.login": "tried to sign in",
  "auth.register": "joined the group",
  "auth.adminReset": "had their password reset from the command line",
  "profile.onboard": "answered the PC question",
  "profile.tier.measured": (p) => (p.from && p.from !== p.to ? `their PC was measured by the installer: ${s(p.to)} (they had chosen ${s(p.from)})` : `their PC was measured by the installer: ${s(p.to)}`),
  "ballot.save": "saved their vote",
  "vote.create": (p) => `created the vote "${s(p.title)}"`,
  "vote.open": "opened the vote",
  "vote.close": (p) => (p.auto ? "the vote closed by itself" : "closed the vote"),
  "vote.delete": (p) => `deleted the vote "${s(p.title)}"`,
  "vote.apply": "applied the vote's results to the mod list",
  "invite.create": "created an invite",
  "invite.revoke": "revoked an invite",
  "user.earlyAccess": (p) => (p.on ? `gave ${s(p.displayName, "a member")} early access` : `took early access away from ${s(p.displayName, "a member")}`),
  "user.setRole": (p) => `changed a member's role to ${s(p.role).toLowerCase()}`,
  "user.remove": (p) => `removed ${s(p.displayName, "a member")} from the group`,
  "user.setMinecraft": (p) => `linked a member to the Minecraft account ${s(p.mcUsername)}`,
  "user.clearMinecraft": "unlinked a member's Minecraft account",
  "launcher.approve": (p) => (p.approve === false ? "refused an installer sign-in" : "approved an installer sign-in"),
  "launcher.revoke": "signed a member's installers out",
  "link.bind": (p) => `linked their Minecraft account ${s(p.mcUsername)}`,
  "link.release": (p) => `let ${s(p.name)} in`,
  "limbo.held": (p) => `${s(p.name)} is waiting in the entrance room`,
  "join.blocked": (p) => `${s(p.name)} was held in the entrance room: ${p.reason === "not live" ? "the server is not open yet" : p.reason === "no report" ? "has not pressed Play on the site" : p.reason === "stale" ? "pressed Play too long ago" : p.reason === "wrong version" ? "pressed Play before the pack changed" : s(p.reason, "Play first")}`,
  "join.ready": (p) => `${s(p.name)} ${p.was === "not live" ? "was let in: the server is open for them now" : "pressed Play and was let in"}${p.back ? ", back to where they were" : ""}`,
  "limbo.kickIdleClosed": (p) => `${s(p.name)} waited too long in the entrance room while the server is not open and was disconnected`,
  "limbo.kickIdlePlay": (p) => `${s(p.name)} waited too long in the entrance room without pressing Play and was disconnected`,
  "limbo.kickIdle": (p) => `${s(p.name)} waited too long in the entrance room and was disconnected`,
  "limbo.build": "built the entrance room",
  "player.revoke": (p) => `kicked ${s(p.name)} and took them off the whitelist`,
  "site.settings": "changed the launch settings",
  "settings.save": (p) => `changed the ${s(p.section, "site")} settings`,
  "branding.save": "changed the branding",
  "announcement.create": "posted an announcement",
  "announcement.pin": "pinned an announcement",
  "announcement.unpin": "unpinned an announcement",
  "announcement.delete": "deleted an announcement",
  "announcement.picture": "added a picture to an announcement",
  "announcement.nopicture": "took the picture off an announcement",
  "modpack.lock": "locked the mod versions",
  "modpack.build": "built the modpack",
  "modpack.sync": "synced the mods to the server",
  "modpack.sync-dry": "checked what a mod sync would change",
  "server.start": "started the server",
  "server.stop": "stopped the server",
  "world.pregenOn": (p) => p.refused
    ? "tried to turn the pre-generation on; the control panel does not let the portal switch sleep mode off"
    : `turned ${p.what === "render" ? "the map render" : "the pre-generation"} on: ${p.mode === "now" ? "now, whoever is playing" : "when nobody's online"}${p.what === "both" ? ", the map rendered afterwards" : ""}${p.capHours ? `, ${s(p.capHours)} hours at most` : ""}; ${s(p.radius)} blocks around ${s(p.x)}, ${s(p.z)}${p.newArea ? " (a new area)" : ""}`,
  "world.pregenOff": (p) => {
    const radius = p.radius ? `radius ${s(p.radius)}` : "";
    // the map: what was in hand was BlueMap's render, which has its own figures
    if (p.what === "render" || (p.what === "both" && p.phase !== "generate")) {
      const at = p.mapPercent === null || p.mapPercent === undefined ? "" : `${s(p.mapPercent)}% of the task in hand`;
      const where = [at, radius].filter(Boolean).join(", ");
      const job = p.what === "both" ? "pre-generation finished and the map rendered" : "the map is rendered";
      if (p.reason === "done") return `${job}${radius ? ` (${radius})` : ""}`;
      return p.reason === "cap" ? `the map render stopped: its hours are up${where ? ` (${where})` : ""}` : `stopped the map render${at ? `, at ${at}` : ""}`;
    }
    return p.reason === "done" ? `pre-generation finished (100%${radius ? `, ${radius}` : ""})` : p.reason === "cap" ? `pre-generation stopped: its hours are up (${s(p.percent)}%${radius ? `, ${radius}` : ""})` : `stopped the pre-generation, at ${s(p.percent)}%`;
  },
  "map.update": (p) => `asked for the map to be brought up to date${p.radius ? `: ${s(p.radius)} blocks around ${s(p.x ?? 0)}, ${s(p.z ?? 0)}` : ""}`,
  "map.stop": "paused the map render",
  "map.start": "let the map render carry on",
  "world.pregen": (p) => `turned the pre-generation on: ${s(p.radius)} blocks around ${s(p.x)}, ${s(p.z)}`,
  "world.pregenContinue": "turned the pre-generation on again",
  "world.pregenPause": "paused the pre-generation",
  "world.pregenCancel": "called the pre-generation off",
  "world.pregenAutoPause": (p) => `a pre-generation nobody had turned on here was paused at ${s(p.percent)}%: the server had been empty for three minutes`,
  "server.kill": "ended the server's process (it was stuck while stopping)",
  "server.restart": (p) => (p.scheduled ? "the planned restart went ahead" : "restarted the server"),
  "server.restart.scheduled": (p) => `planned a restart in ${s(p.minutes)} minutes`,
  "server.restart.cancelled": "called off the planned restart",
  "server.backup": "started a backup",
  "server.say": (p) => `said in game: ${s(p.text, "")}`,
  "installer.report": (p) => p.refused ? "sent a report of a run that cannot have happened: the site is not open for them" : `${p.mode === "play"
    ? (p.outcome === "ok" ? `pressed Play: ${s(p.packVersion, "the pack")}, launcher opened` : p.outcome === "cancelled" ? "pressed Play and closed the window" : `pressed Play and it failed${p.failedStep ? ` at "${s(p.failedStep)}"` : ""}`)
    : (p.outcome === "ok" ? `installed ${s(p.packVersion, "the pack")}: all good` : p.outcome === "cancelled" ? `stopped the installer${p.failedStep ? ` at "${s(p.failedStep)}"` : ""}` : `ran the installer and it failed${p.failedStep ? ` at "${s(p.failedStep)}"` : ""}`)}${p.updatedFrom ? ` (the installer updated itself, ${s(p.updatedFrom)} to ${s(p.installerVersion, "the current one")})` : p.updateProblem ? " (the installer could not update itself)" : ""}`,
  "files.download": (p) => `downloaded ${s(p.path)} from the server`,
  "retention.prune": (p) => `old entries cleared: ${s(p.events, "0")} events, ${s(p.ips, "0")} addresses${p.installs ? `, ${s(p.installs)} install reports` : ""}`,
  "events.export": "exported the event log",
  "analytics.export": "exported the analytics",
};

// Phrases that already say who (or have no who).
const SELF_CONTAINED = new Set(["limbo.held", "limbo.kickIdle", "retention.prune", "join.blocked", "join.ready", "limbo.kickIdlePlay", "limbo.kickIdleClosed", "world.pregenAutoPause"]);
const POSSESSIVE = new Set(["profile.tier.measured"]); // "Alex: their PC was measured …"
// Phrases that already say how it went.
const OUTCOME_IN_PHRASE = new Set(["installer.report"]);

export function describeAction(action: string, actor: Actor, params: unknown, result: AuditResult = "OK"): string {
  const p = (params && typeof params === "object" ? params : {}) as P;
  const phrase = PHRASES[action];
  const text = typeof phrase === "function" ? phrase(p) : (phrase ?? action);
  const who = actor.name ?? (actor.role === "system" ? "The portal" : "Someone");
  const auto = action === "vote.close" && p.auto;
  const planned = action === "server.restart" && p.scheduled;
  // what the pre-generation does by itself has no "who": "Pre-generation finished (100%, radius 1500)"
  const byItself = (action === "world.pregenOff" && (p.reason === "done" || p.reason === "cap")) || (action === "world.pregenContinue" && !actor.name);
  const said = byItself && action === "world.pregenContinue" ? "pre-generation turned on again" : text;
  const body = byItself ? said.charAt(0).toUpperCase() + said.slice(1) : SELF_CONTAINED.has(action) || auto || planned ? text.charAt(0).toUpperCase() + text.slice(1) : phrase === undefined || POSSESSIVE.has(action) ? `${who}: ${text}` : `${who} ${text}`;
  const suffix = result === "OK" || OUTCOME_IN_PHRASE.has(action) ? "" : result === "DENIED" ? " (refused)" : result === "TIMEOUT" ? " (no answer)" : " (failed)";
  return `${body}${suffix}`.slice(0, 500);
}

export function auditMeta(action: string, params: unknown, result: AuditResult, detail: string | null | undefined) {
  return { action, params: params ?? {}, result, detail: detail ?? null };
}

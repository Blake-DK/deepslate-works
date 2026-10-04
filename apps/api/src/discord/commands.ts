// docs/22 §6: the slash commands, one list. Who may use them is the portal's role, never Discord's. Every command that
// changes something is an existing api route (with its own permission check and audit), called in-process with
// "via Discord" on its event.
import { stateLine, type ServerState } from "../shared/server-state.js";
import { escapeText } from "./lines.js";
import { SIGN_IN_FIRST } from "./votes.js";

const STRING = 3;
const INTEGER = 4;
const SUB = 1;

export const COMMANDS = [
  { name: "online", description: "Who is playing right now", type: 1 },
  { name: "status", description: "How the server is doing", type: 1 },
  { name: "votes", description: "Open votes, and which you have not answered", type: 1 },
  { name: "season", description: "The season and your points", type: 1 },
  { name: "me", description: "Your Minecraft name, play time and versions", type: 1 },
  { name: "wake", description: "Wake the server if it is asleep", type: 1 },
  { name: "restart", description: "Admins: restart the server after a countdown", type: 1, options: [{ type: INTEGER, name: "minutes", description: "Minutes before the restart (1 to 30)", required: true, min_value: 1, max_value: 30 }] },
  { name: "cancel-restart", description: "Admins: call off the planned restart", type: 1 },
  { name: "say", description: "Admins: a line in the game's chat", type: 1, options: [{ type: STRING, name: "text", description: "What to say", required: true, max_length: 200 }] },
  {
    name: "feed", description: "Admins: pause or resume the Discord feed", type: 1,
    options: [{ type: SUB, name: "pause", description: "Post nothing until resumed" }, { type: SUB, name: "resume", description: "Post again (what happened meanwhile is not posted)" }],
  },
] as const;

export type Member = { id: string; role: "ADMIN" | "PLAYER"; mcUsername: string | null };
export type Routed = { status: number; body: { error?: { message?: string }; [k: string]: unknown } | null };

export type CommandDeps = {
  host: string; // deepslate.dsw.test
  portal: string; // https://deepslate.dsw.test
  member(discordId: string): Promise<Member | null>;
  server(): { state: ServerState; players: string[]; tps: number | null; sleepInMin: number | null };
  pack(): Promise<string | null>;
  openVotes(userId: string | null): Promise<Array<{ title: string; link: string | null; answered: boolean | null }>>;
  me(userId: string): Promise<{ mcName: string | null; lastPlayed: Date | null; hoursThisMonth: number; app: string | null; currentApp: string | null; pack: string | null; currentPack: string | null }>;
  /** An api route, in-process, as this member, with "via Discord" on what it audits. */
  route(member: Member, method: "POST" | "DELETE", url: string, body?: unknown): Promise<Routed>;
  setPaused(paused: boolean, member: Member): Promise<void>;
  /** The season in the site's one line, and this member's place on the scoreboard; null line: no season to speak of. */
  season?(userId: string | null): Promise<{ line: string | null; mine: { place: number; points: number } | null }>;
};

export type Reply = { content: string; ephemeral: boolean };
type Option = { name: string; type: number; value?: unknown; options?: Option[] };

const say = (content: string, ephemeral = true): Reply => ({ content, ephemeral });
const ADMIN_ONLY = "Only the portal's admins can do that.";
const refusal = (r: Routed, fallback: string) => r.body?.error?.message ?? fallback;

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const last = n % 10;
  return `${n}${tens >= 11 && tens <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

function uk(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export async function runCommand(d: CommandDeps, name: string, options: Option[] | undefined, discordId: string): Promise<Reply> {
  const opt = (n: string) => options?.find((o) => o.name === n)?.value;
  switch (name) {
    case "online": {
      const s = d.server();
      if (s.state === "online" && s.players.length > 0) return say(`${s.players.length} online: ${s.players.map(escapeText).join(", ")}`, false);
      if (s.state === "online") return say("Nobody is on. The server is up and goes to sleep when it has been empty for a while.", false);
      return say("Nobody is on. The server is asleep and wakes when you press Play.", false);
    }
    case "status": {
      const s = d.server();
      const pack = await d.pack();
      const lines = [`**${stateLine(s.state, { players: s.players.length, sleepInMin: s.sleepInMin })}**`];
      if (s.state === "online" && s.tps !== null) lines.push(`TPS ${s.tps.toFixed(1)}`);
      if (pack) lines.push(`Pack ${pack}`);
      lines.push(`Open the site: ${d.portal}`);
      return say(lines.join("\n"), false);
    }
    case "votes": {
      const m = await d.member(discordId);
      const list = await d.openVotes(m?.id ?? null);
      if (list.length === 0) return say("There is no open vote.");
      return say(list.map((v) => `• ${v.link ? `[${escapeText(v.title)}](${v.link})` : escapeText(v.title)}${v.answered === false ? " · you have not voted yet" : v.answered ? " · you have voted" : ""}`).join("\n"));
    }
    case "season": {
      const m = await d.member(discordId);
      const s = await d.season?.(m?.id ?? null);
      if (!s?.line) return say("No season is running yet.");
      const mine = s.mine ? `\nYou are ${ordinal(s.mine.place)} with ${s.mine.points} ${s.mine.points === 1 ? "point" : "points"}.` : m ? "\nYou have no points yet." : "";
      return say(`${escapeText(s.line)}${mine}\n${d.portal}/season`);
    }
  }
  // from here on: members of the portal only
  const m = await d.member(discordId);
  if (!m) return say(SIGN_IN_FIRST(d.host));
  switch (name) {
    case "me": {
      const me = await d.me(m.id);
      const lines = [
        `Minecraft: ${me.mcName ? escapeText(me.mcName) : "not linked yet"}`,
        `Last played: ${me.lastPlayed ? uk(me.lastPlayed) : "not yet"}`,
        `This month: ${me.hoursThisMonth.toFixed(1)} hours`,
        `App: ${me.app ?? "not installed"}${me.app && me.currentApp ? (me.app === me.currentApp ? " (current)" : ` (current is ${me.currentApp})`) : ""}`,
        `Pack: ${me.pack ?? "not installed"}${me.pack && me.currentPack ? (me.pack === me.currentPack ? " (current)" : ` (the server runs ${me.currentPack}: press Play to update)`) : ""}`,
      ];
      return say(lines.join("\n"));
    }
    case "wake": {
      const r = await d.route(m, "POST", "/server/wake", { via: "discord" });
      if (r.status === 202) return say("Waking the server, about 30 s.", false);
      if (r.body && (r.body as { result?: string }).result === "awake") return say("The server is already up.");
      if (r.body && (r.body as { result?: string }).result === "already") return say("The server is already waking up.");
      return say(refusal(r, "The server could not be woken."));
    }
  }
  // admins of the portal only
  if (m.role !== "ADMIN") return say(ADMIN_ONLY);
  switch (name) {
    case "restart": {
      const minutes = Number(opt("minutes"));
      const r = await d.route(m, "POST", "/server/restart-in", { minutes });
      return r.status === 200 ? say(`The server restarts in ${minutes} ${minutes === 1 ? "minute" : "minutes"}. Players see a countdown in the game.`, false) : say(refusal(r, "The restart could not be planned."));
    }
    case "cancel-restart": {
      const r = await d.route(m, "DELETE", "/server/schedule");
      return r.status === 200 && (r.body as { cancelled?: boolean } | null)?.cancelled ? say("The planned restart is called off.", false) : say(r.status === 200 ? "No restart was planned." : refusal(r, "Could not call it off."));
    }
    case "say": {
      const text = String(opt("text") ?? "").replace(/[\r\n]+/g, " ").trim();
      if (!text) return say("Say what?");
      const r = await d.route(m, "POST", "/actions/server.say", { text });
      return r.status === 200 ? say("Said in the game.") : say(refusal(r, "It could not be said."));
    }
    case "feed": {
      const sub = options?.[0]?.name;
      if (sub !== "pause" && sub !== "resume") return say("Pause or resume?");
      await d.setPaused(sub === "pause", m);
      return say(sub === "pause" ? "The Discord feed is paused." : "The Discord feed is on again. What happened meanwhile is not posted.");
    }
  }
  return say("I don't know that command.");
}

// Admin → Server → Pre-generation: what api knows about chunky, in words. Pure, so it is tested.

export type Pregen = {
  status: "none" | "running" | "paused" | "finished" | "cancelled";
  world: string | null;
  chunks: number | null;
  percent: number | null;
  eta: string | null;
  rate: number | null;
  pausedBy: "empty" | null;
  at: string | null;
  serverRunning?: boolean;
  online?: number;
  /** What an admin has asked for: off, for a number of hours, or whenever nobody is on until it is done. */
  plan?: { mode: "off" } | { mode: "hours" | "empty"; until: string | null; whilePlaying: boolean; since: string };
  /** What the keeper is doing right now. */
  doing?: string;
  roundSec?: number;
};

/** Rough numbers for a radius: chunks, hours of generating at 50 chunks a second, and disk at 13 KB a chunk (both measured on 2026-09-29). */
export function pregenCost(radius: number): { chunks: number; hours: number; gb: number } {
  const side = Math.ceil((2 * radius) / 16) + 1;
  const chunks = side * side;
  return { chunks, hours: chunks / 50 / 3600, gb: (chunks * 13) / 1_048_576 };
}

const DOING: Record<string, string> = {
  run: "generating",
  wake: "waking the server",
  wait: "waiting for the server",
  "pause:playing": "waiting: somebody is playing",
  "pause:round": "between two rounds: paused and saved, the server goes to sleep and is woken again",
  kill: "the server hung while stopping and is being ended",
};

/** The line about what has been asked for. `until` is written out by the caller (UK time). */
export function planText(p: Pregen | null, until: string | null): { on: boolean; line: string } {
  const plan = p?.plan;
  if (!plan || plan.mode === "off") return { on: false, line: "Off. Nothing generates, and nothing will start by itself." };
  const what = plan.mode === "hours" ? `On until ${until ?? "the time is up"}` : "On whenever nobody is on the server, until the area is done";
  const playing = plan.whilePlaying ? ", also while people are playing" : plan.mode === "hours" ? ", waiting whenever somebody is playing" : "";
  const doing = p?.doing && DOING[p.doing] ? ` Right now: ${DOING[p.doing]}.` : "";
  return { on: true, line: `${what}${playing}.${doing}` };
}

export type PregenText = {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
  line: string;
  can: { start: boolean; continue: boolean; pause: boolean; cancel: boolean };
};

const n = (v: number | null) => (v === null ? "?" : v.toLocaleString("en-GB"));

export function pregenText(p: Pregen | null): PregenText {
  if (!p) return { label: "not known", tone: "neutral", line: "The site's backend did not answer.", can: { start: false, continue: false, pause: false, cancel: false } };
  switch (p.status) {
    case "running":
      return {
        label: "on",
        tone: "warn",
        line: `Running: ${n(p.chunks)} chunks made, ${p.percent?.toFixed(1) ?? "?"}%${p.eta ? `, about ${p.eta} to go` : ""}${p.rate ? `, ${p.rate.toFixed(0)} chunks a second` : ""}.`,
        can: { start: false, continue: false, pause: true, cancel: false },
      };
    case "paused":
      return {
        label: "off (paused)",
        tone: "neutral",
        line: `Paused at ${p.percent?.toFixed(1) ?? "?"}% (${n(p.chunks)} chunks made)${p.pausedBy === "empty" ? ", by itself: the server had been empty for three minutes" : ""}. It stays paused until you turn it on.`,
        can: { start: true, continue: true, pause: false, cancel: true },
      };
    case "finished":
      return { label: "done", tone: "good", line: `Finished${p.chunks ? `: ${n(p.chunks)} chunks` : ""}. Nothing is running.`, can: { start: true, continue: false, pause: false, cancel: false } };
    case "cancelled":
      return { label: "off", tone: "neutral", line: "Called off. Nothing is running.", can: { start: true, continue: false, pause: false, cancel: false } };
    default:
      // api has heard nothing from chunky since it started; a paused task may still be waiting on the server
      return { label: "off", tone: "neutral", line: "Nothing is running. If a pre-generation was paused earlier, \"carry on\" picks it up where it stopped.", can: { start: true, continue: true, pause: true, cancel: true } };
  }
}

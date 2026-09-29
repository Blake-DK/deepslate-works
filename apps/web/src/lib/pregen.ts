// Admin → Server → Pre-generation: what api says, in words. Pure, so it is tested.

export type Area = { x: number; z: number; radius: number };
export type Plan =
  | { mode: "off"; area: Area | null }
  | { mode: "empty" | "now"; area: Area; window: { from: string; to: string } | null; capHours: number | null; ranMs: number; since: string; sleepWas: boolean | null };

export type Pregen = {
  status: "none" | "running" | "paused" | "finished" | "cancelled";
  chunks: number | null;
  percent: number | null;
  eta: string | null;
  rate: number | null;
  at: string | null;
  plan: Plan;
  /** What api is doing about it right now. */
  doing: string;
  /** Chunks in the area of the plan. */
  total: number | null;
  sleep: { node: string; permission: string; allowed: boolean | null; on: boolean | null; delayMin: number | null; problem: string | null };
  serverState: number;
  serverRunning: boolean;
  online: number;
};

const n = (v: number) => v.toLocaleString("en-GB");

/** Rough numbers for a radius: chunks, hours of generating at 50 chunks a second, disk at 13 KB a chunk (both measured on 2026-09-29). */
export function pregenCost(radius: number): { chunks: number; hours: number; gb: number } {
  const side = Math.ceil((2 * radius) / 16) + 1;
  const chunks = side * side;
  return { chunks, hours: chunks / 50 / 3600, gb: (chunks * 13) / 1_048_576 };
}

export type Progress = { line: string; percent: number | null };

/** Chunks done and to do, the percentage and chunky's own estimate. */
export function progress(p: Pregen | null): Progress {
  if (!p) return { line: "The site's backend did not answer.", percent: null };
  const total = p.total ?? (p.chunks !== null && p.percent ? Math.round((p.chunks / p.percent) * 100) : null);
  if (p.status === "finished") return { line: `Done: ${p.chunks !== null ? n(p.chunks) : total !== null ? n(total) : "all"} chunks, 100%.`, percent: 100 };
  if (p.chunks === null || p.percent === null) {
    return { line: p.plan.area ? `No figures yet${total !== null ? ` (the area is ${n(total)} chunks)` : ""}: chunky says where it stands when it next runs.` : "Nothing has been generated ahead of time yet.", percent: null };
  }
  const to = p.status === "running" && p.eta ? `, about ${p.eta} to go` : "";
  const rate = p.status === "running" && p.rate ? `, ${p.rate.toFixed(0)} chunks a second` : "";
  return { line: `${n(p.chunks)} of ${total !== null ? n(total) : "?"} chunks, ${p.percent.toFixed(1)}%${to}${rate}.`, percent: p.percent };
}

const DOING: Record<string, string> = {
  run: "generating",
  "pause:playing": "waiting: somebody is playing",
  "pause:sleep": "paused before the server is put to sleep; it carries on when the server is next started",
  "idle:window": "waiting for its time of day",
  "idle:server": "waiting: the server is not running. It is not started from here; it carries on when it next runs",
};

export type ModeText = { on: boolean; label: string; tone: "warn" | "neutral" | "good"; line: string };

export function modeText(p: Pregen | null): ModeText {
  const plan = p?.plan;
  if (!p || !plan || plan.mode === "off") return { on: false, label: p?.status === "finished" ? "done" : "off", tone: p?.status === "finished" ? "good" : "neutral", line: "Off. Nothing generates, and nothing starts by itself." };
  const hours = plan.capHours !== null ? `${plan.capHours} ${plan.capHours === 1 ? "hour" : "hours"} of generating at most (${(plan.ranMs / 3_600_000).toFixed(1)} so far)` : "until the area is done";
  const what = plan.mode === "now" ? `On: now, whoever is playing, ${hours}` : `On: when nobody's online${plan.window ? `, between ${plan.window.from} and ${plan.window.to}` : ""}, ${hours}`;
  const doing = DOING[p.doing] ? ` Right now: ${DOING[p.doing]}.` : "";
  return { on: true, label: plan.mode === "now" ? "on: now" : "on: when nobody's online", tone: "warn", line: `${what}.${doing}` };
}

export type SleepText = { ok: boolean; line: string; grant: string | null };

/** What AMP's sleep mode is, and whether the portal may switch it off. Without that, nothing can be turned on. */
export function sleepText(p: Pregen | null): SleepText {
  const s = p?.sleep;
  if (!s || s.allowed === null) return { ok: false, line: `The server's control panel could not be asked about its sleep mode${s?.problem ? ` (${s.problem})` : ""}.`, grant: null };
  const is = s.on === null ? "" : s.on ? `Sleep mode is on${s.delayMin ? `: an empty server is put to sleep after ${s.delayMin} minutes` : ""}. ` : "Sleep mode is off. ";
  if (s.allowed) return { ok: true, line: `${is}While a mode is on, the portal switches it off, and puts it back as it was afterwards.`, grant: null };
  return { ok: false, line: `${is}The control panel does not let the portal switch it off, so nothing can be turned on: the server would be put to sleep in the middle of generating.`, grant: s.permission };
}

import { z } from "zod";

// Installer 2.0.1 (planner, 2026-10-01): every report carries what the app's Extras tab has switched on, the last
// Apply, the checks and what the game's own log says. Shown in one line on Admin → Installs and the player page.

const ids = z.array(z.string().max(40)).max(20);
export const extrasReportSchema = z
  .object({
    on: ids.default([]),
    shader: z.enum(["none", "light", "full"]).nullish().transform((v) => v ?? "none"),
    queued: z.boolean().nullish().transform((v) => v ?? false), // chosen with Later: installs when the game closes
    lastApply: z.object({ at: z.string().max(40).nullish(), ok: z.boolean(), error: z.string().max(300).nullish() }).nullish().transform((v) => v ?? null),
    verify: z.object({ ok: z.boolean(), failed: z.array(z.string().max(200)).max(20).default([]) }).nullish().transform((v) => v ?? null),
    // "active": the game's latest.log shows them loaded; "waiting": the game has not run since the change
    inGame: z.object({ state: z.enum(["active", "waiting", "problems", "none"]), active: ids.default([]), problems: z.array(z.string().max(200)).max(20).default([]) }).nullish().transform((v) => v ?? null),
  })
  .strip();
export type ExtrasReport = z.infer<typeof extrasReportSchema>;

const SHADER = { light: "Light shaders", full: "Full shaders" } as const;

/** "Extras: Iris (Light shaders), Falling Leaves. Verified, active in game." `names`: extra id → name. */
export function extrasLine(x: ExtrasReport | null | undefined, names: Record<string, string> = {}): string | null {
  if (!x) return null;
  const shown = x.on.filter((id) => !id.startsWith("shader-"));
  if (shown.length === 0) return x.queued ? "Extras: none yet (changes wait for the game to close)." : "Extras: none.";
  const list = shown.map((id) => {
    const name = (names[id] ?? id).replace(/\s*\(shaders\)$/i, "");
    return id === "iris" && x.shader !== "none" ? `${name} (${SHADER[x.shader]})` : name;
  });
  const parts: string[] = [];
  if (x.lastApply && !x.lastApply.ok) parts.push(`last Apply failed${x.lastApply.error ? ` (${x.lastApply.error})` : ""}`);
  if (x.verify) parts.push(x.verify.ok ? "Verified" : `${x.verify.failed.length} check${x.verify.failed.length === 1 ? "" : "s"} failed`);
  if (x.queued) parts.push("changes wait for the game to close");
  if (x.inGame) parts.push(x.inGame.state === "active" ? "active in game" : x.inGame.state === "waiting" ? "not started in game yet" : x.inGame.state === "problems" ? `problems in game: ${x.inGame.problems.join("; ")}` : "");
  const tail = parts.filter(Boolean).join(", ");
  return `Extras: ${list.join(", ")}.${tail ? ` ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.` : ""}`;
}

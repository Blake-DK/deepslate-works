import type { LockEntry, LockFile } from "./lock";
import type { ShaderChoice } from "./schema";

// Visual extras (planner, 2026-10-01): client-only mods, a resource pack and two shader packs that each member
// switches on for themselves on the Me page. The server never has them, and a member with them plays alongside one
// without. Default off.

export const SHADER_CHOICES = ["none", "light", "full"] as const satisfies readonly ShaderChoice[];
export type VisualChoice = { extras: boolean; shader: ShaderChoice };
export const NO_EXTRAS: VisualChoice = { extras: false, shader: "none" };

export function visualChoice(u: { visualExtras?: boolean | null; shaders?: string | null } | null | undefined): VisualChoice {
  if (!u?.visualExtras) return NO_EXTRAS;
  const shader = (SHADER_CHOICES as readonly string[]).includes(u.shaders ?? "") ? (u.shaders as ShaderChoice) : "none";
  return { extras: true, shader };
}

const kindOf = (e: Pick<LockEntry, "kind">) => e.kind ?? "mod";

/**
 * What one member's PC gets out of the lock: the mods (everyone's, plus the optional ones if extras are on), the
 * resource packs to switch on, and the one shader pack. `known` lists every optional resource and shader pack file
 * in the pack, so the installer can take out the ones it put there earlier and never touches a player's own.
 */
export function packFor(lock: Pick<LockFile, "files">, choice: VisualChoice) {
  const mods = lock.files.filter((f) => kindOf(f) === "mod" && (!f.optional || choice.extras));
  const resourcepacks = choice.extras ? lock.files.filter((f) => kindOf(f) === "resourcepack") : [];
  const shaderpack = choice.extras && choice.shader !== "none" ? (lock.files.find((f) => kindOf(f) === "shader" && f.shader === choice.shader) ?? null) : null;
  const known = {
    resourcepacks: lock.files.filter((f) => kindOf(f) === "resourcepack").map((f) => f.filename),
    shaderpacks: lock.files.filter((f) => kindOf(f) === "shader").map((f) => f.filename),
  };
  return { mods, resourcepacks, shaderpack, known };
}

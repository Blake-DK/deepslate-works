import type { Amp } from "../amp/client.js";
import { audit } from "../audit.js";
import { actions, type ActionCtx, type ActionName } from "./registry.js";

export type RunResult = { ok: boolean; commands: number; detail?: string };

/** Validates, builds, sends and audits one action. The only place console commands leave the api. */
export async function runAction(amp: Amp, ctx: ActionCtx, name: ActionName, rawInput: unknown, callerId: string | null): Promise<RunResult> {
  const action = actions[name];
  const parsed = action.input.safeParse(rawInput);
  if (!parsed.success) {
    await audit({ userId: callerId, action: name, params: {} as object, result: "DENIED", detail: "validation" });
    return { ok: false, commands: 0, detail: "validation" };
  }
  const input = parsed.data;
  const commands = (action.build as (c: ActionCtx, i: unknown) => string[])(ctx, input);
  let sent = 0;
  try {
    for (const cmd of commands) {
      await amp.call("Core", "SendConsoleMessage", { message: cmd });
      sent++;
    }
    if (name !== "limbo.keep" && name !== "server.list" && name !== "server.pings" && name !== "player.where" && name !== "limbo.remindPlay" && name !== "limbo.remindClosed" && !((name === "map.status" || name === "map.list") && callerId === null)) {
      await audit({ userId: callerId, action: name, params: input as object, result: "OK", detail: `${sent} command(s)` });
    }
    return { ok: true, commands: sent };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await audit({ userId: callerId, action: name, params: input as object, result: "FAILED", detail: `${detail} after ${sent}/${commands.length}` });
    return { ok: false, commands: sent, detail };
  }
}

import type { Amp } from "../amp/client.js";
import { audit } from "../audit.js";
import { actions, type ActionCtx, type ActionName } from "./registry.js";

export type RunResult = { ok: boolean; commands: number; detail?: string };

/** Validates, builds, sends and audits one action. The only place console commands leave the api. */
// Not written into the event log: questions that change nothing and come round every few seconds, and what the
// portal says to somebody at the door, which has a line of its own there ("… is waiting in the entrance room").
const QUIET = new Set<string>(["limbo.keep", "limbo.bar", "server.list", "server.pings", "player.where", "limbo.remindPlay", "limbo.remindClosed", "limbo.remindOld", "map.status", "map.list", "inv.read", "inv.set", "inv.clear", "inv.give", "inv.notify"]); // the inventory editor writes its own row, after the server answered
const QUIET_FROM_THE_PORTAL = new Set<string>(["limbo.hold", "limbo.remind"]);

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
    if (!QUIET.has(name) && !(callerId === null && QUIET_FROM_THE_PORTAL.has(name))) {
      await audit({ userId: callerId, action: name, params: input as object, result: "OK", detail: `${sent} command(s)` });
    }
    return { ok: true, commands: sent };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await audit({ userId: callerId, action: name, params: input as object, result: "FAILED", detail: `${detail} after ${sent}/${commands.length}` });
    return { ok: false, commands: sent, detail };
  }
}

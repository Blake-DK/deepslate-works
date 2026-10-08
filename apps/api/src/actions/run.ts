import type { Amp } from "../amp/client.js";
import { audit } from "../audit.js";
import { actions, type ActionCtx, type ActionName } from "./registry.js";

export type RunResult = { ok: boolean; commands: number; detail?: string };

/** The wait between an action's commands (Action.gapMs). Tests put an instant one in. */
export let gapWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function setGapWait(w: (ms: number) => Promise<void>) { gapWait = w; }

/** Validates, builds, sends and audits one action. The only place console commands leave the api. */
// Not written into the event log: questions that change nothing and come round every few seconds, and what the
// portal says to somebody at the door, which has a line of its own there ("… is waiting in the entrance room").
const QUIET = new Set<string>(["limbo.keep", "limbo.bar", "limbo.bookCheck", "limbo.giveBook", "server.list", "server.pings", "server.tps", "server.welcome", "player.where", "limbo.remindPlay", "limbo.remindClosed", "limbo.remindOld", "limbo.remindMods", "limbo.remindVote", "map.status", "map.list", "inv.read", "inv.set", "inv.clear", "inv.give", "inv.notify", "ground.count", "ground.warn", "ground.mark", "ground.kill", "ground.done", "season.grant", "season.revoke", "season.testReset"]); // the inventory editor writes its own row, after the server answered; status/ground.ts one "items.clear" row with the count; the test server's Reset one row with what it cleared
const QUIET_FROM_THE_PORTAL = new Set<string>(["limbo.hold", "limbo.remind"]);
const isQuiet = (name: string, callerId: string | null) => QUIET.has(name) || (callerId === null && QUIET_FROM_THE_PORTAL.has(name));
// Quiet actions that are failing now. Their failures are not written into the event log either: with AMP out of
// reach that was a row every few seconds, kept for good (docs/35 R-03). One line in the api's log when it begins.
const quietFailing = new Set<string>();

export async function runAction(amp: Amp, ctx: ActionCtx, name: ActionName, rawInput: unknown, callerId: string | null): Promise<RunResult> {
  const action = actions[name];
  const parsed = action.input.safeParse(rawInput);
  if (!parsed.success) {
    await audit({ userId: callerId, action: name, params: {} as object, result: "DENIED", detail: "validation" });
    return { ok: false, commands: 0, detail: "validation" };
  }
  const input = parsed.data;
  const commands = (action.build as (c: ActionCtx, i: unknown) => string[])(ctx, input);
  const kept = (action as { audit?: (i: unknown) => object }).audit?.(input) ?? (input as object);
  let sent = 0;
  try {
    const gap = (action as { gapMs?: number }).gapMs ?? 0;
    for (const cmd of commands) {
      if (sent > 0 && gap > 0) await gapWait(gap);
      await amp.call("Core", "SendConsoleMessage", { message: cmd });
      sent++;
    }
    if (!isQuiet(name, callerId)) {
      await audit({ userId: callerId, action: name, params: kept, result: "OK", detail: `${sent} command(s)` });
    }
    quietFailing.delete(name);
    return { ok: true, commands: sent };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (!isQuiet(name, callerId)) {
      await audit({ userId: callerId, action: name, params: kept, result: "FAILED", detail: `${detail} after ${sent}/${commands.length}` });
    } else if (!quietFailing.has(name)) {
      quietFailing.add(name);
      console.warn(JSON.stringify({ level: 40, msg: "action failed (said once, until it goes through again)", action: name, detail: `${detail} after ${sent}/${commands.length}` }));
    }
    return { ok: false, commands: sent, detail };
  }
}

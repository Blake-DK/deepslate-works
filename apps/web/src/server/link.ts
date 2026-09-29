import "server-only";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { audit } from "@/server/events";
import type { CurrentUser } from "@/server/auth/session";
import { CODE_TTL_MS, codeUsable, GuessLimiter } from "@/shared/join-code";

// docs/14: a code from the white room ties the Minecraft account waiting there to the member who is signed in.
// Two ways in, one effect: the link clicked in the chat (/link/<code>) and the code typed on /join.

export type LinkOutcome = { tone: "success" | "error" | "info"; title: string; text: string };

const g = globalThis as unknown as { __dwJoinGuesses?: GuessLimiter };
/** Wrong codes: 5 per member and 30 for everyone together in 15 minutes (shared/join-code.ts). */
export const guesses = (g.__dwJoinGuesses ??= new GuessLimiter());

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

export async function linkWithCode(user: CurrentUser, code: string, via: "link" | "join"): Promise<LinkOutcome> {
  const wait = guesses.wait(user.id);
  if (wait !== null) {
    await audit({ userId: user.id, action: "link.bind", params: { via, refused: "too_many_guesses" }, result: "DENIED" });
    return { tone: "error", title: "Too many wrong codes", text: `Wait ${minutes(wait)} minute${minutes(wait) === 1 ? "" : "s"}, then try again with the code on your screen in the game.` };
  }
  const link = code ? await db.linkCode.findUnique({ where: { code } }) : null;
  if (!link || !codeUsable(link, user.id, new Date())) {
    guesses.miss(user.id);
    return link
      ? { tone: "error", title: "That code has run out", text: `Codes last ${CODE_TTL_MS / 60_000} minutes and a new one is made each time you join. Join the server again and use the code on your screen.` }
      : { tone: "error", title: "That code isn't right", text: "Check it against the one on your screen in the game (it is 6 letters and numbers, like ABC-123)." };
  }
  if (user.mcUuid && user.mcUuid !== link.mcUuid) {
    return { tone: "error", title: "Your account is already linked", text: `This portal account is linked to ${user.mcUsername}. If ${link.mcUsername} is also you, ask Alex to unlink first.` };
  }
  const other = await db.user.findFirst({ where: { mcUuid: link.mcUuid, NOT: { id: user.id } }, select: { displayName: true } });
  if (other) {
    return { tone: "error", title: "That Minecraft account belongs to someone else", text: `${link.mcUsername} is linked to ${other.displayName}. Ask Alex if that's wrong.` };
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mcUuid: link.mcUuid, mcUsername: link.mcUsername, verifiedAt: user.verifiedAt ?? new Date(), guildMember: true } });
    await tx.linkCode.update({ where: { code: link.code }, data: { usedById: user.id } });
    await audit({ userId: user.id, action: "link.bind", params: { code: link.code, via, mcUsername: link.mcUsername, mcUuid: link.mcUuid }, result: "OK" }, tx);
  });
  let released = false;
  try {
    const r = await apiFetch<{ released: boolean }>("/link/release", { method: "POST", body: { uuid: link.mcUuid }, caller: { id: user.id, role: user.role } });
    released = r.released;
  } catch {}
  return released
    ? { tone: "success", title: `Linked as ${link.mcUsername}`, text: "You're through. Go back to the game: you should already be out of the room." }
    : { tone: "success", title: `Linked as ${link.mcUsername}`, text: "You're linked. Go back to the game: if you're still in the room, it tells you what else is needed (or re-join)." };
}

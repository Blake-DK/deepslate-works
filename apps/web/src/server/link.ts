import "server-only";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { audit } from "@/server/events";
import type { CurrentUser } from "@/server/auth/session";
import { CODE_TTL_MS, codeUsable, GuessLimiter } from "@/shared/join-code";

// docs/14: a code from the white room ties the Minecraft account waiting there to the member who is signed in.
// Two ways in, one effect: the link clicked in the chat (/link/<code>) and the code typed on /join.
//
// docs/31 B-06: looking at a code and using it are two steps. Opening the link (a GET) only shows whose Minecraft
// account it is and asks; the button under it (a POST, a server action) does the linking. Before, one click on a
// link somebody else sent tied their Minecraft account to yours and let them into the world.

export type LinkOutcome = { tone: "success" | "error" | "info"; title: string; text: string };
/** What a code would do for this member: an answer to show, or the Minecraft account it would link. */
export type LinkCheck = { ok: false; outcome: LinkOutcome } | { ok: true; code: string; mcUsername: string; mcUuid: string; already: boolean };

const g = globalThis as unknown as { __dwJoinGuesses?: GuessLimiter };
/** Wrong codes: 5 per member and 30 for everyone together in 15 minutes (shared/join-code.ts). */
export const guesses = (g.__dwJoinGuesses ??= new GuessLimiter());

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

type LinkUser = Pick<CurrentUser, "id" | "role" | "mcUuid" | "mcUsername" | "verifiedAt" | "discordId" | "guildMember" | "outsideAuth">;

/** Looks at a code and changes nothing, except that a code that does not exist counts as a wrong guess. */
export async function checkCode(user: LinkUser, code: string, via: "link" | "join"): Promise<LinkCheck> {
  const wait = guesses.wait(user.id);
  if (wait !== null) {
    await audit({ userId: user.id, action: "link.bind", params: { via, refused: "too_many_guesses" }, result: "DENIED" });
    return { ok: false, outcome: { tone: "error", title: "Too many wrong codes", text: `Wait ${minutes(wait)} minute${minutes(wait) === 1 ? "" : "s"}, then try again with the code on your screen in the game.` } };
  }
  // docs/31 B-05: somebody who has left the Discord server does not link their way back in. Linking used to set
  // the flag true again without asking Discord. Whoever came in by an invite is not asked about the server.
  if (user.discordId && !user.guildMember && !user.outsideAuth) {
    await audit({ userId: user.id, action: "link.bind", params: { via, refused: "left_discord" }, result: "DENIED" });
    return { ok: false, outcome: { tone: "error", title: "Sign in with Discord again", text: "You are no longer in the group's Discord server, or we have not seen you there since you left. Join it again, sign out here and sign in with Discord, then use the code." } };
  }
  const link = code ? await db.linkCode.findUnique({ where: { code } }) : null;
  if (!link) {
    guesses.miss(user.id); // only a code that does not exist is a guess (B-16): an old link of one's own is not
    return { ok: false, outcome: { tone: "error", title: "That code isn't right", text: "Check it against the one on your screen in the game (it is 6 letters and numbers, like ABC-123)." } };
  }
  if (!codeUsable(link, user.id, new Date())) {
    return { ok: false, outcome: { tone: "error", title: "That code has run out", text: `Codes last ${CODE_TTL_MS / 60_000} minutes and a new one is made each time you join. Join the server again and use the code on your screen.` } };
  }
  if (user.mcUuid && user.mcUuid !== link.mcUuid) {
    return { ok: false, outcome: { tone: "error", title: "Your account is already linked", text: `This portal account is linked to ${user.mcUsername}. If ${link.mcUsername} is also you, ask Alex to unlink first.` } };
  }
  const other = await db.user.findFirst({ where: { mcUuid: link.mcUuid, NOT: { id: user.id } }, select: { displayName: true } });
  if (other) {
    return { ok: false, outcome: { tone: "error", title: "That Minecraft account belongs to someone else", text: `${link.mcUsername} is linked to ${other.displayName}. Ask Alex if that's wrong.` } };
  }
  return { ok: true, code: link.code, mcUsername: link.mcUsername, mcUuid: link.mcUuid, already: user.mcUuid === link.mcUuid && link.usedById === user.id };
}

/** Links. Only ever called from a POST (the confirm button's server action). */
export async function linkWithCode(user: LinkUser, code: string, via: "link" | "join"): Promise<LinkOutcome> {
  const check = await checkCode(user, code, via);
  if (!check.ok) return check.outcome;
  await db.$transaction(async (tx) => {
    // `guildMember` is not written here (B-05): only a Discord sign-in or the bot says who is in the server.
    // docs/35 R-30: the name is unique too. Somebody else's row may still hold it from before they renamed in
    // Minecraft; this account has it now, so the old row lets go of it rather than the link failing.
    await tx.user.updateMany({ where: { mcUsername: check.mcUsername, NOT: { id: user.id } }, data: { mcUsername: null } });
    await tx.user.update({ where: { id: user.id }, data: { mcUuid: check.mcUuid, mcUsername: check.mcUsername, verifiedAt: user.verifiedAt ?? new Date() } });
    await tx.linkCode.update({ where: { code: check.code }, data: { usedById: user.id } });
    await audit({ userId: user.id, action: "link.bind", params: { code: check.code, via, mcUsername: check.mcUsername, mcUuid: check.mcUuid }, result: "OK" }, tx);
  });
  let released = false;
  try {
    const r = await apiFetch<{ released: boolean }>("/link/release", { method: "POST", body: { uuid: check.mcUuid }, caller: { id: user.id, role: user.role } });
    released = r.released;
  } catch {}
  return linkedOutcome(check.mcUsername, released);
}

export const linkedOutcome = (mcUsername: string, released: boolean): LinkOutcome =>
  released
    ? { tone: "success", title: `Linked as ${mcUsername}`, text: "You're through. Go back to the game: you should already be out of the room." }
    : { tone: "success", title: `Linked as ${mcUsername}`, text: "You're linked. Go back to the game: if you're still in the room, it tells you what else is needed (or re-join)." };

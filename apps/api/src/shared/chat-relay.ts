// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// Whose game chat is posted to #game-chat (docs/22 §5). Each member has a setting only admins change (Alex,
// 2026-10-11): Automatic, the docs/50 rule and everybody's default; Always post; Never post. Their chat in the game
// is the same whichever it is.

export const CHAT_RELAYS = ["AUTO", "ALWAYS", "NEVER"] as const;
export type ChatRelay = (typeof CHAT_RELAYS)[number];

export type ChatRelayMember = { chatRelay?: ChatRelay | null; outsideAuth: boolean; discordId: string | null; guildMember: boolean };

/**
 * True: the member's game chat stays in the game. An admin's Always or Never wins. Automatic is docs/50 §1: let in
 * without the Discord server (`outsideAuth`) and not in it now, which is no Discord account on the portal
 * (`guildMember` defaults to true, so a null `discordId` is looked at on its own) or one that is not in the server.
 */
export function chatStaysInGame(u: ChatRelayMember): boolean {
  if (u.chatRelay === "ALWAYS") return false;
  if (u.chatRelay === "NEVER") return true;
  return u.outsideAuth && (u.discordId === null || !u.guildMember);
}

/** The choices as the admin's dialog shows them. */
export const CHAT_RELAY_CHOICES: ReadonlyArray<{ value: ChatRelay; title: string; example: string }> = [
  { value: "AUTO", title: "Automatic", example: "Posted, unless they were let in without the Discord server and are not in it now." },
  { value: "ALWAYS", title: "Always post", example: "Posted, whether or not they are in the Discord server." },
  { value: "NEVER", title: "Never post", example: "Kept in the game, even while they are in the Discord server." },
];

// Who a Discord sign-in lets in. Pure, so it is tested.

export type DoorInput = {
  gate: boolean; // DISCORD_GUILD_ID is set: the Discord server rule is on
  inGuild: boolean | null; // null: Discord did not answer (docs/35 R-12). Never read as "left the server".
  existing: { outsideAuth: boolean } | null;
  invite: boolean; // a valid invite link was opened just before
  staleInvite?: boolean; // an invite link was opened, but it has been used, has run out or never existed
  autoJoin: boolean; // DISCORD_GUILD_AUTO_JOIN: being in the server is the invite
  bootstrapAdmin: boolean;
};

/**
 * `in`: a member, as they are. `exempt`: a member who is not in the server and has a new invite: the invite is used
 * and they go on the outside list. `create`: a new member (`outside` when an invite brought them).
 * An invite stands in for the Discord server: whoever came in by one is never asked about the server again.
 * `discord-unavailable`: the rule is on, the answer was needed and Discord gave none: this sign-in is refused and
 * nothing is changed, so a hiccup at Discord never ends anyone's sessions.
 */
export type Door = { door: "in" } | { door: "exempt" } | { door: "create"; outside: boolean } | { door: "refuse"; why: "not-in-server" | "no-invite" | "invite-invalid" | "discord-unavailable" };

export function discordDoor(i: DoorInput): Door {
  const serverOk = !i.gate || i.inGuild === true;
  // Whoever is on the outside list is never asked, so they get in without an answer too.
  if (i.gate && i.inGuild === null && !i.existing?.outsideAuth) return { door: "refuse", why: "discord-unavailable" };
  // Refused with a link that no longer works: say that, it is what they can do something about.
  const refuse = (why: "not-in-server" | "no-invite"): Door => ({ door: "refuse", why: i.staleInvite && !i.invite ? "invite-invalid" : why });
  if (i.existing) {
    if (serverOk || i.existing.outsideAuth) return { door: "in" };
    return i.invite ? { door: "exempt" } : refuse("not-in-server");
  }
  if (i.invite) return { door: "create", outside: true };
  if (!serverOk) return refuse("not-in-server");
  if (i.bootstrapAdmin || (i.gate && i.inGuild === true && i.autoJoin)) return { door: "create", outside: false };
  return refuse("no-invite");
}

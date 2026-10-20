import "server-only";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { audit } from "@/server/events";
import { apiFetch } from "@/server/api-client";
import { INVITE_COOKIE } from "@/server/auth/constants";
import { consumeInvite, findValidInvite } from "@/server/auth/invites";
import { discordDoor } from "@/server/auth/discord-door";
import { createUser, touchLastSeen } from "@/server/auth/users";
import { isBlocked } from "@/server/auth/blocked";
import { onDemoted } from "@/server/auth/admin-login";
import { parseSsoClaims, ssoLink, ssoNewAdmin, ssoRole } from "@/server/auth/sso-core";
import { roleChangeData } from "@/lib/role-change";
import { testerGone } from "@/server/testers";

// docs/04 "Sign-in through Authentik": the Auth.js signIn callback for provider `authentik`. Which account it is comes
// from sso-core.ts (by Discord ID, never by email); whether it may come in is the same door as the site's own Discord
// sign-in (discord-door.ts), with the Discord server asked of api's bot, as Authentik hands over no Discord token.

/** Whether a Discord account is in the group's Discord server, by api's bot. Null: no answer (no bot, outage). */
export async function guildMemberViaApi(discordId: string): Promise<boolean | null> {
  try {
    const r = await apiFetch<{ member?: unknown }>(`/discord/member/${encodeURIComponent(discordId)}`, { timeoutMs: 8000 });
    return typeof r?.member === "boolean" ? r.member : null;
  } catch {
    return null;
  }
}

const select = { id: true, displayName: true, role: true, discordId: true, authentikSub: true, outsideAuth: true, guildMember: true, builderTools: true } as const;

/** true to go on, or the page to send the member to. */
export async function ssoSignIn(profile: unknown): Promise<true | string> {
  const c = parseSsoClaims(profile);
  if (!c) {
    await audit({ action: "auth.login", params: { via: "authentik" }, result: "DENIED", detail: "no sub in the id token" });
    return "/login?error=sso-failed";
  }
  const [bySub, byDiscord] = await Promise.all([
    db.user.findUnique({ where: { authentikSub: c.sub }, select }),
    c.discordId ? db.user.findUnique({ where: { discordId: c.discordId }, select }) : null,
  ]);
  const link = ssoLink(c, bySub, byDiscord);
  const params = { via: "authentik", discordId: c.discordId };
  if (link.kind === "conflict") {
    await audit({ userId: bySub?.id ?? byDiscord?.id ?? null, action: "auth.login", params, result: "DENIED", detail: link.detail });
    return "/login?error=account-mismatch";
  }
  const existing = link.kind === "existing" ? link.user : null;
  const discordId = c.discordId ?? existing?.discordId ?? null;
  // docs/31 B-37: removed and blocked by an admin. Refused before anything is asked or made.
  if (discordId && (await isBlocked(discordId))) {
    await audit({ action: "auth.login", params, result: "DENIED", detail: "blocked" });
    return "/login?error=blocked";
  }
  // Without a Discord connection nobody is in the Discord server: such a member comes in by an invite link.
  const gate = Boolean(env.DISCORD_GUILD_ID);
  const inGuild = !gate ? false : discordId ? await guildMemberViaApi(discordId) : false;
  const jar = await cookies();
  const inviteCode = jar.get(INVITE_COOKIE)?.value;
  const invite = inviteCode ? await findValidInvite(inviteCode) : null;
  const dropInvite = () => {
    try {
      jar.delete(INVITE_COOKIE);
    } catch {
      /* not writable in this context; the cookie expires on its own */
    }
  };
  const owner = Boolean(env.ADMIN_DISCORD_ID) && discordId === env.ADMIN_DISCORD_ID;
  const decision = discordDoor({ gate, inGuild, existing, invite: Boolean(invite), staleInvite: Boolean(inviteCode) && !invite, autoJoin: env.DISCORD_GUILD_AUTO_JOIN, bootstrapAdmin: owner });
  const leftServer = gate && discordId !== null && inGuild === false;
  const refused = async (why: "not-in-server" | "no-invite" | "invite-invalid" | "invite-needed", detail: string) => {
    // As at the site's own Discord sign-in: someone who has left the server ends every session and installer token,
    // and the Tester switch goes off (docs/14 §7, docs/31 B-05, docs/57).
    if (leftServer && existing?.guildMember && !existing.outsideAuth) {
      await db.user.update({ where: { id: existing.id }, data: { guildMember: false, sessionVersion: { increment: 1 } } });
      await db.launcherAuth.updateMany({ where: { userId: existing.id, status: "approved" }, data: { status: "denied" } });
      await testerGone("left the Discord server", null, { id: existing.id }).catch(() => undefined);
    }
    if (why === "invite-invalid") dropInvite();
    await audit({ userId: existing?.id ?? null, action: "auth.login", params, result: "DENIED", detail });
    return `/login?error=${why}`;
  };
  if (decision.door === "refuse") {
    if (decision.why === "discord-unavailable") {
      await audit({ userId: existing?.id ?? null, action: "auth.login", params, result: "DENIED", detail: "discord did not answer" });
      return "/login?error=discord-unavailable";
    }
    if (!discordId && decision.why !== "invite-invalid") return refused("invite-needed", "no discord connection and no invite");
    const detail = decision.why === "invite-invalid" ? "invite link not valid" : decision.why === "not-in-server" ? "not in discord server" : "no invite";
    return refused(decision.why, detail);
  }

  if (!existing) {
    try {
      await createUser({
        displayName: c.name ?? "Player",
        discordId: c.discordId ?? undefined,
        authentikSub: c.sub,
        admin: ssoNewAdmin(c.roles),
        inviteCode: invite?.code,
        invitedById: invite?.createdBy,
        outsideAuth: decision.door === "create" && decision.outside,
        guildMember: gate && c.discordId ? (inGuild ?? undefined) : undefined,
      });
    } catch (err) {
      // the invite was used by someone else between the look and the write
      if (invite) return refused("invite-invalid", "invite used in the meantime");
      throw err;
    }
    dropInvite();
    return true;
  }

  if (decision.door === "exempt") {
    // A member who is not in the server, with a new invite: the invite is theirs and the server rule no longer applies.
    try {
      await db.$transaction(async (tx) => {
        await consumeInvite(tx, invite!.code, existing.id);
        await tx.user.update({ where: { id: existing.id }, data: { outsideAuth: true } });
        await audit({ userId: existing.id, action: "user.outsideAuth", params: { id: existing.id, displayName: existing.displayName, on: true, invite: invite!.code }, result: "OK" }, tx);
      });
    } catch {
      return refused("invite-invalid", "not in discord server, invite not usable");
    }
    dropInvite();
  }

  const data: { authentikSub?: string; discordId?: string; guildMember?: boolean } = {};
  if (existing.authentikSub !== c.sub) data.authentikSub = c.sub;
  if (link.kind === "existing" && link.setDiscordId) data.discordId = link.setDiscordId;
  // The flag stays what Discord last said, for whoever is on the outside list too (as at the site's own Discord sign-in).
  if (gate && discordId && inGuild !== null && existing.guildMember !== inGuild) data.guildMember = inGuild;
  if (Object.keys(data).length > 0) await db.user.update({ where: { id: existing.id }, data });
  if (link.kind === "existing" && (link.firstLink || link.relink)) {
    await audit({ userId: existing.id, action: "auth.ssoLinked", params: { relink: link.relink, discordId: data.discordId ?? existing.discordId }, result: "OK" });
  }
  const role = ssoRole({ current: existing.role, roles: c.roles, owner, firstLink: link.kind === "existing" && link.firstLink });
  if (role) await applyRole(existing, role);
  await touchLastSeen(existing.id);
  return true;
}

/** Authentik's group moved the member's role. The same changes as Make admin / Make player on People. */
async function applyRole(u: { id: string; role: Role; builderTools: boolean }, role: Role) {
  // Builder mode off first, while the api still reads them as an admin (it asks the database who the caller is).
  if (role === "PLAYER" && u.builderTools) {
    await apiFetch("/builder/mode", { method: "POST", body: { on: false, userId: u.id }, caller: { id: u.id, role: "ADMIN" } }).catch(() => null);
  }
  await db.user.update({ where: { id: u.id }, data: { role, ...roleChangeData(u.role, role) } });
  // Made a player: password sign-in off and every older session ended (this sign-in's session reads the new version).
  if (role === "PLAYER") await onDemoted(u.id);
  await audit({ userId: u.id, action: "auth.ssoRole", params: { id: u.id, role, from: u.role }, result: "OK" });
}

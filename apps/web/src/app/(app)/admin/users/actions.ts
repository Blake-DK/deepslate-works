"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { lookupMinecraftUser } from "@/server/mojang";
import { MC_USERNAME_RE } from "@/server/auth/constants";
import { revokeLauncherTokens } from "@/server/launcher";
import { apiFetch } from "@/server/api-client";
import { audit } from "@/server/events";
import { onDemoted, removeAdminLogin } from "@/server/auth/admin-login";
import { block, unblock } from "@/server/auth/blocked";

export async function setRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), role: z.enum(["ADMIN", "PLAYER"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.id === admin.id) return;
  const before = await db.user.findUnique({ where: { id: parsed.data.id }, select: { builderTools: true } });
  // docs/37: Builder tools are for admins only; made a player, they go, and Builder mode with them
  await db.user.update({ where: { id: parsed.data.id }, data: { role: parsed.data.role, ...(parsed.data.role === "PLAYER" ? { builderTools: false } : {}) } });
  if (parsed.data.role === "PLAYER" && before?.builderTools) await builderOff(admin.id, parsed.data.id);
  // Made a player (planner, 2026-10-01): password sign-in off and every session they have ended, at once.
  if (parsed.data.role === "PLAYER") await onDemoted(parsed.data.id);
  await audit({ userId: admin.id, action: "user.setRole", params: parsed.data, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
}

/** Builder mode off for a member who loses Builder tools: survival, if they are on the server. Best effort. */
async function builderOff(adminId: string, userId: string) {
  await apiFetch("/builder/mode", { method: "POST", body: { on: false, userId }, caller: { id: adminId, role: "ADMIN" } }).catch(() => null);
}

/**
 * docs/37 Step 2: Builder tools, for admins only and only the ones ticked. With them, the admin may switch Builder
 * mode (creative, where WorldEdit works) on for themselves on Admin → Seasons → Builds. Unticked: Builder mode off.
 */
export async function setBuilderToolsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), on: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const on = parsed.data.on === "1";
  const u = await db.user.findUnique({ where: { id: parsed.data.id }, select: { displayName: true, role: true } });
  if (!u || (on && u.role !== "ADMIN")) return;
  await db.user.update({ where: { id: parsed.data.id }, data: { builderTools: on } });
  await audit({ userId: admin.id, action: "user.builderTools", params: { id: parsed.data.id, displayName: u.displayName, on }, result: "OK" });
  if (!on) await builderOff(admin.id, parsed.data.id);
  revalidatePath("/admin/people");
  revalidatePath("/admin/seasons");
  revalidatePath("/players/[uuid]", "page");
}

/** docs/13 "Early access": the member uses the portal as if it were live while it is not. */
export async function setEarlyAccessAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), on: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const on = parsed.data.on === "1";
  const u = await db.user.update({ where: { id: parsed.data.id }, data: { earlyAccess: on }, select: { displayName: true } }).catch(() => null);
  if (u) await audit({ userId: admin.id, action: "user.earlyAccess", params: { id: parsed.data.id, displayName: u.displayName, on }, result: "OK" });
  for (const p of ["/admin/people", "/admin/joining", "/", "/help", "/me"]) revalidatePath(p);
  revalidatePath("/players/[uuid]", "page");
}

/**
 * The outside list: a member the Discord server rule is not applied to. An invite link puts people on it; this is
 * the same by hand, and the way off it. Taken off while not in the server: treated as someone who has just left.
 */
export async function setOutsideAuthAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), on: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const on = parsed.data.on === "1";
  const u = await db.user.update({ where: { id: parsed.data.id }, data: { outsideAuth: on }, select: { displayName: true, discordId: true, guildMember: true, mcUuid: true } }).catch(() => null);
  if (!u) return;
  await audit({ userId: admin.id, action: "user.outsideAuth", params: { id: parsed.data.id, displayName: u.displayName, on }, result: "OK" });
  if (!on && u.discordId && !u.guildMember) {
    await db.user.update({ where: { id: parsed.data.id }, data: { sessionVersion: { increment: 1 } } });
    await revokeLauncherTokens(parsed.data.id);
    if (u.mcUuid) {
      try {
        await apiFetch("/player/revoke", { method: "POST", body: { uuid: u.mcUuid }, caller: { id: admin.id, role: "ADMIN" } });
      } catch {}
    }
  }
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
}

export async function removeUserAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id || id === admin.id) return;
  const removed = await db.user.delete({ where: { id } }).catch(() => null);
  // docs/31 B-37: "Remove and block". Without it, their next Discord sign-in makes a new account while they are in the server.
  const blocked = Boolean(removed?.discordId) && formData.get("block") === "1";
  if (blocked) await block(removed!.discordId!, removed!.displayName, admin.id);
  if (removed?.mcUuid) {
    try {
      await apiFetch("/player/revoke", { method: "POST", body: { uuid: removed.mcUuid, reason: "Removed from the group by an admin." }, caller: { id: admin.id, role: "ADMIN" } });
    } catch {}
  }
  if (removed) {
    await audit({ userId: admin.id, action: "user.remove", params: { id, displayName: removed.displayName, mcUsername: removed.mcUsername, blocked }, result: "OK" });
  }
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
}

export async function unblockAction(formData: FormData) {
  const admin = await requireAdmin();
  const discordId = String(formData.get("discordId") ?? "");
  if (!/^\d{5,25}$/.test(discordId)) return;
  if (await unblock(discordId, admin.id)) await audit({ userId: admin.id, action: "user.unblock", params: { discordId, displayName: String(formData.get("name") ?? "").slice(0, 80) }, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
}

/** Admin tool (docs/14 keeps the Mojang lookup for admins only): set or verify a member's Minecraft account by name. */
export async function setMinecraftNameAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = z.object({ id: z.string().min(1), mcUsername: z.string().trim().regex(MC_USERNAME_RE) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/people?error=name");
  const lookup = await lookupMinecraftUser(parsed.data.mcUsername);
  if (!lookup.ok) redirect(`/admin/people?error=${lookup.reason}`);
  const taken = await db.user.findFirst({ where: { mcUuid: lookup.uuid, NOT: { id: parsed.data.id } }, select: { displayName: true } });
  if (taken) redirect("/admin/people?error=taken");
  // docs/35 R-30: the name is unique too; a row that still holds it from before its owner renamed lets go of it.
  await db.$transaction([
    db.user.updateMany({ where: { mcUsername: lookup.name, NOT: { id: parsed.data.id } }, data: { mcUsername: null } }),
    db.user.update({ where: { id: parsed.data.id }, data: { mcUsername: lookup.name, mcUuid: lookup.uuid, verifiedAt: new Date() } }),
  ]);
  await audit({ userId: admin.id, action: "user.setMinecraft", params: { id: parsed.data.id, mcUsername: lookup.name, mcUuid: lookup.uuid }, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
  redirect("/admin/people");
}

export async function clearMinecraftNameAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const u = await db.user.update({ where: { id }, data: { mcUsername: null, mcUuid: null, verifiedAt: null } }).catch(() => null);
  if (u) await audit({ userId: admin.id, action: "user.clearMinecraft", params: { id }, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
  redirect("/admin/people");
}

export async function revokeLauncherAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const n = await revokeLauncherTokens(id);
  await audit({ userId: admin.id, action: "launcher.revoke", params: { id, revoked: n }, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
  revalidatePath("/players/[uuid]", "page");
  redirect("/admin/people");
}

/** Another admin's password sign-in off (planner, 2026-10-01). Never their password: only off. */
export async function turnOffPasswordSignInAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id || id === admin.id) return;
  const who = await db.user.findUnique({ where: { id }, select: { displayName: true } });
  if (who && (await removeAdminLogin(id))) await audit({ userId: admin.id, action: "auth.adminOff", params: { forId: id, forName: who.displayName }, result: "OK" });
  revalidatePath("/admin/people");
  revalidatePath("/admin/joining");
}

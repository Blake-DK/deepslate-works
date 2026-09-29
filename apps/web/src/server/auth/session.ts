import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof loadCurrentUser>>>;

export async function loadCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, displayName: true, role: true, discordId: true, email: true,
      mcUsername: true, mcUuid: true, pcTier: true, pcTierSource: true, pcTierWhy: true, pcTierAt: true, verifiedAt: true, guildMember: true, createdAt: true, lastSeenAt: true, earlyAccess: true,
    },
  });
}

/** Logged-in user or redirect to /login. Role is read from the database, so promotions apply immediately. */
export async function requireUser(next?: string) {
  const user = await loadCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/** "Onboarded" = answered the PC question. The Minecraft account is linked in game later (docs/14). */
export async function requireOnboardedUser(next?: string) {
  const user = await requireUser(next);
  if (!user.pcTier) redirect(next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

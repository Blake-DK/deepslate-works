import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { normaliseInviteCode } from "@/server/auth/invite-codes";
import { apiFetch } from "@/server/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { audit } from "@/server/events";

export const metadata: Metadata = { title: "Link Minecraft" };

// docs/14 §6: the clickable link from the wait room. Login (Discord, guild check) happens on the way here.
export default async function LinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normaliseInviteCode(raw);
  const user = await requireOnboardedUser(`/link/${code}`);

  const link = code ? await db.linkCode.findUnique({ where: { code } }) : null;
  let outcome: { tone: "success" | "error" | "info"; title: string; text: string };

  if (!link || link.expiresAt.getTime() < Date.now() || (link.usedById && link.usedById !== user.id)) {
    outcome = { tone: "error", title: "That link has expired", text: "Codes last 15 minutes. Join the server again and click the fresh link in the chat." };
  } else if (user.mcUuid && user.mcUuid !== link.mcUuid) {
    outcome = { tone: "error", title: "Your account is already linked", text: `This portal account is linked to ${user.mcUsername}. If ${link.mcUsername} is also you, ask Alex to unlink first.` };
  } else {
    const other = await db.user.findFirst({ where: { mcUuid: link.mcUuid, NOT: { id: user.id } }, select: { displayName: true } });
    if (other) {
      outcome = { tone: "error", title: "That Minecraft account belongs to someone else", text: `${link.mcUsername} is linked to ${other.displayName}. Ask Alex if that's wrong.` };
    } else {
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { mcUuid: link.mcUuid, mcUsername: link.mcUsername, verifiedAt: user.verifiedAt ?? new Date(), guildMember: true } });
        await tx.linkCode.update({ where: { code }, data: { usedById: user.id } });
        await audit({ userId: user.id, action: "link.bind", params: { code, mcUsername: link.mcUsername, mcUuid: link.mcUuid }, result: "OK" }, tx);
      });
      let released = false;
      try {
        const r = await apiFetch<{ released: boolean }>("/link/release", { method: "POST", body: { uuid: link.mcUuid }, caller: { id: user.id, role: user.role } });
        released = r.released;
      } catch {}
      outcome = released
        ? { tone: "success", title: `Linked as ${link.mcUsername}`, text: "You're through. Go back to the game: you should already be out of the room." }
        : { tone: "success", title: `Linked as ${link.mcUsername}`, text: "You're linked. Join the server (or re-join) and you'll go straight to spawn." };
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Link your Minecraft account</h1>
      <Alert tone={outcome.tone}><strong>{outcome.title}.</strong> {outcome.text}</Alert>
      <Card>
        <CardHeader>
          <CardTitle>What just happened</CardTitle>
          <CardDescription>The server holds new players in a small room until their Minecraft account is tied to a Discord account in the group. Yours ({user.displayName}) {user.mcUsername ? <>is linked to <span className="font-mono text-foreground">{user.mcUsername}</span></> : "isn't linked yet"}.</CardDescription>
        </CardHeader>
        <CardContent><Link href="/me" className={buttonClasses("secondary", "sm")}>My account</Link></CardContent>
      </Card>
    </div>
  );
}

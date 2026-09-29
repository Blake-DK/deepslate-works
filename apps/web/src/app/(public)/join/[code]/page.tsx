import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/env";
import { db } from "@/server/db";
import { inviteState, normaliseInviteCode } from "@/server/auth/invite-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { joinWithDiscord } from "./actions";
import { getBranding } from "@/server/branding";
import { CODE_RE } from "@/shared/join-code";

export const metadata: Metadata = { title: "Join" };

const STATE_TEXT = {
  used: "This invite has already been used. Ask Alex for a new one.",
  expired: "This invite has expired. Ask Alex for a new one.",
  unknown: "That invite link isn't right. Check it with Alex.",
} as const;

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normaliseInviteCode(raw);
  // A join code from the white room (6 characters) typed after /join/ instead of into the box on /join.
  if (CODE_RE.test(code)) redirect(`/join?code=${code}`);
  const session = await auth();
  if (session?.user) redirect("/");
  const invite = code ? await db.invite.findUnique({ where: { code } }) : null;
  const state = inviteState(invite);

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{(await getBranding()).name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">A private modded Minecraft server for friends. Dig it out with drills, wire it up with factories.</p>
      </div>
      {state !== "valid" ? (
        <Alert tone="error">{STATE_TEXT[state]}</Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re invited{invite?.note ? `, ${invite.note.replace(/^for\s+/i, "")}` : ""}</CardTitle>
            <CardDescription>One tap and you&apos;re in. We only read your Discord name, nothing else.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={joinWithDiscord}>
              <input type="hidden" name="code" value={code} />
              <Button type="submit" size="lg" className="w-full" disabled={!env.discordEnabled}>Continue with Discord</Button>
            </form>
            {!env.discordEnabled && <p className="text-xs text-muted-foreground">Discord sign-in isn&apos;t set up yet. Use the email option below.</p>}
            <p className="text-center text-sm">
              <Link href={`/join/${code}/email`} className="text-muted-foreground underline">No Discord?</Link>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { linkWithCode } from "@/server/link";
import { readCode } from "@/shared/join-code";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Link Minecraft" };

// docs/14 §6: the clickable link from the wait room. Login (Discord, guild check) happens on the way here.
// The same as typing the code on /join (server/link.ts).
export default async function LinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = readCode(raw);
  const user = await requireOnboardedUser(`/link/${code}`);
  const outcome = await linkWithCode(user, code, "link");
  const linked = outcome.tone === "success" ? outcome.title.replace(/^Linked as /, "") : user.mcUsername;

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Link your Minecraft account</h1>
      <Alert tone={outcome.tone}><strong>{outcome.title}.</strong> {outcome.text}</Alert>
      <Card>
        <CardHeader>
          <CardTitle>What just happened</CardTitle>
          <CardDescription>The server holds new players in a small room until their Minecraft account is tied to a Discord account in the group. Yours ({user.displayName}) {linked ? <>is linked to <span className="font-mono text-foreground">{linked}</span></> : "isn't linked yet"}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/me" className={buttonClasses("secondary", "sm")}>My account</Link>
          {outcome.tone === "error" && <Link href="/join" className={buttonClasses("secondary", "sm")}>Type the code instead</Link>}
        </CardContent>
      </Card>
    </div>
  );
}

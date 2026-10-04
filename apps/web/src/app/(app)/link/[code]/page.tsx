import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { checkCode, linkedOutcome } from "@/server/link";
import { LinkConfirm } from "@/components/link-confirm";
import { readCode } from "@/shared/join-code";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Link Minecraft" };

// docs/14 §6: the clickable link from the wait room. Login (Discord, guild check) happens on the way here.
// The same as typing the code on /join (server/link.ts). Opening the link links nothing (docs/31 B-06): it asks,
// and the button under the question does it.
export default async function LinkPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ done?: string }> }) {
  const { code: raw } = await params;
  const { done } = await searchParams;
  const code = readCode(raw);
  const user = await requireOnboardedUser(`/link/${code}`);
  const check = await checkCode(user, code, "link");
  // after the button: the code is theirs and used by them, so the page says what happened instead of asking again
  const outcome = check.ok ? (check.already ? linkedOutcome(check.mcUsername, done === "1") : null) : check.outcome;
  const linked = check.ok && check.already ? check.mcUsername : user.mcUsername;

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Link your Minecraft account</h1>
      {outcome && <Alert tone={outcome.tone}><strong>{outcome.title}.</strong> {outcome.text}</Alert>}
      {check.ok && !check.already && <LinkConfirm code={check.code} mcUsername={check.mcUsername} displayName={user.displayName} via="link" />}
      <Card>
        <CardHeader>
          <CardTitle>{outcome?.tone === "success" ? "What just happened" : "What this is"}</CardTitle>
          <CardDescription>The server holds new players in a small room until their Minecraft account is tied to a Discord account in the group. Yours ({user.displayName}) {linked ? <>is linked to <span className="font-mono text-foreground">{linked}</span></> : "isn't linked yet"}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/me" className={buttonClasses("secondary", "sm")}>My account</Link>
          {outcome?.tone === "error" && <Link href="/join" className={buttonClasses("secondary", "sm")}>Type the code instead</Link>}
        </CardContent>
      </Card>
    </div>
  );
}

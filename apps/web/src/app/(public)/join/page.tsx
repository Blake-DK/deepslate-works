import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { linkWithCode } from "@/server/link";
import { readCode } from "@/shared/join-code";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { CodeInput } from "./code-input";

export const metadata: Metadata = { title: "Join code" };

// docs/14 "The join code": the second way out of the white room, for whoever missed the link in the chat or is
// on a phone. Signed in with Discord (the middleware sends them to /login first), type the code shown on the
// screen in the game, and it does what the link does. A plain form that sends GET; the box adds the hyphen as the
// code is typed (code-input.tsx), and without script it still takes the code with or without one.
// /join/<8 characters> is an invite (the folder next to this one); a room code typed there comes here.
export default async function JoinCodePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code: raw } = await searchParams;
  const code = readCode(raw ?? "");
  const user = await requireOnboardedUser(code ? `/join?code=${code}` : "/join");
  const outcome = code ? await linkWithCode(user, code, "join") : null;
  const done = outcome?.tone === "success";

  return (
    <div className="mx-auto max-w-sm space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-semibold">Enter your join code</h1>
      {outcome && <Alert tone={outcome.tone}><strong>{outcome.title}.</strong> {outcome.text}</Alert>}
      {!done && (
        <Card>
          <CardHeader>
            <CardTitle>The code on your screen</CardTitle>
            <CardDescription>In the game it says &quot;go to …/join and enter ABC-123&quot;. Signed in as {user.displayName}.</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" action="/join" className="space-y-3">
              <div>
                <Label htmlFor="code">Code</Label>
                <CodeInput />
              </div>
              <Button type="submit" size="lg" className="w-full">Link my Minecraft account</Button>
            </form>
            <p className="mt-3 text-sm text-muted-foreground" data-testid="no-chat">Can&apos;t open chat in Minecraft? That&apos;s your Microsoft account&apos;s privacy setting, not the server. The book in your hand or this page works either way.</p>
          </CardContent>
        </Card>
      )}
      <p className="text-center text-sm">
        <Link href="/me" className={buttonClasses("secondary", "sm")}>My account</Link>
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCurrentUser } from "@/server/auth/session";
import { findValidInvite } from "@/server/auth/invites";
import { MIN_PASSWORD_LENGTH } from "@/server/auth/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { registerWithEmail } from "../actions";

export const metadata: Metadata = { title: "Join with email" };

const ERRORS: Record<string, string> = {
  name: "Pick a display name between 2 and 32 characters.",
  email: "That email address doesn't look right.",
  password: `Password needs at least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`,
  "email-taken": "That email is already in the group. Sign in instead.",
  "invite-gone": "That invite was just used. Ask Alex for another.",
  "rate-limited": "Too many attempts. Wait a minute and try again.",
  "discord-off": "Discord sign-in isn't set up yet, so use email for now.",
  form: "Check the form and try again.",
};

export default async function JoinEmailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> }) {
  if (await loadCurrentUser()) redirect("/");
  const { code } = await params;
  const { error } = await searchParams;
  const invite = await findValidInvite(code);
  if (!invite) redirect(`/join/${encodeURIComponent(code)}`);

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      {error && <Alert tone={error === "discord-off" ? "info" : "error"}>{ERRORS[error] ?? ERRORS.form}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Join with email</CardTitle>
          <CardDescription>For the one person without Discord. Everyone else: <Link href={`/join/${invite.code}`} className="underline">go back</Link>.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={registerWithEmail} className="space-y-3">
            <input type="hidden" name="code" value={invite.code} />
            <div>
              <Label htmlFor="displayName">What should we call you?</Label>
              <Input id="displayName" name="displayName" autoComplete="nickname" required minLength={2} maxLength={32} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <Label htmlFor="password">Password (at least {MIN_PASSWORD_LENGTH} characters)</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} />
            </div>
            <Button type="submit" size="lg" className="w-full">Create my account</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

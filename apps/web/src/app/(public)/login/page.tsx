import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCurrentUser } from "@/server/auth/session";
import { env } from "@/env";
import { getBranding } from "@/server/branding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { discordLogin, emailLogin } from "./actions";
import { getGettingIn } from "@/server/guide";
import { Markdown } from "@/components/markdown";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "no-invite": "That Discord account isn't in the group yet. Ask Alex for an invite link, open it, and sign in from there.",
  "invite-invalid": "That invite link doesn't work any more: it has been used already or has run out. Ask Alex for a new one.",
  blocked: "This Discord account has been removed from the group. Talk to Alex.",
  "not-in-server": "That Discord account isn't in the group's Discord server, so it can't sign in here. Join the Discord server and try again, or ask Alex for an invite link.",
  credentials: "Wrong email or password.",
  "rate-limited": "Too many attempts. Wait a minute and try again.",
  "discord-off": "Discord sign-in isn't set up yet. Use email for now.",
  OAuthCallbackError: "Discord didn't complete the sign-in. Try again.",
  AccessDenied: "That Discord account isn't in the group yet. You need an invite link from Alex.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (await loadCurrentUser()) redirect("/");
  const { error, next } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;
  const [brand, steps] = await Promise.all([getBranding(), getGettingIn()]);

  return (
    // docs/23 §4: the banner above (260 px here) carries the picture, the logo, the name and the tagline
    <div className="mx-auto max-w-[440px] space-y-4">
      <h1 className="sr-only">Sign in to {brand.name}</h1>
      {message && <Alert tone="error">{message}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Already in the group? Continue with the account you joined with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={discordLogin}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <Button type="submit" size="lg" className="w-full text-base!" disabled={!env.discordEnabled}>Continue with Discord</Button>
          </form>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Sign in with email</summary>
            <form action={emailLogin} className="mt-3 space-y-3">
              <input type="hidden" name="next" value={next ?? "/"} />
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" variant="secondary" className="w-full">Sign in</Button>
            </form>
          </details>
        </CardContent>
      </Card>
      {steps && (
        <Card data-testid="getting-in">
          <CardHeader>
            <CardTitle>Getting in</CardTitle>
          </CardHeader>
          <CardContent className="text-sm"><Markdown text={steps} /></CardContent>
        </Card>
      )}
      <p className="text-center text-sm text-muted-foreground">Not in the group yet? You need an invite link from Alex.</p>
      <p className="text-center text-xs"><Link href={next ? `/login/admin?next=${encodeURIComponent(next)}` : "/login/admin"} className="text-muted-foreground underline" data-testid="admin-signin-link">Admin sign-in</Link></p>
    </div>
  );
}

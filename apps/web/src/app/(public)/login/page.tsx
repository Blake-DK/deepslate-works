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
  "no-invite": "That Discord account isn't in the group yet. You need an invite link from Alex.",
  "not-in-server": "You need to be in the group's Discord server to sign in. Ask Alex for the server invite first.",
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
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded banner; the optimiser does not handle SVG */}
      {brand.bannerUrl && <img src={brand.bannerUrl} alt="" className="max-h-40 w-full rounded-xl border object-cover" />}
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded logo */}
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="mx-auto mb-2 h-16 w-auto max-w-40 object-contain" style={brand.generated?.pixel ? { imageRendering: "pixelated" } : undefined} />}
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="tagline">{brand.tagline || "A private Minecraft server for friends."}</p>
      </div>
      {message && <Alert tone="error">{message}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Already in the group? Continue with the account you joined with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={discordLogin}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <Button type="submit" size="lg" className="w-full" disabled={!env.discordEnabled}>Continue with Discord</Button>
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
      <p className="text-center text-xs text-muted-foreground">New here? Ask Alex for an invite link.</p>
      <p className="text-center text-xs"><Link href={next ? `/login/admin?next=${encodeURIComponent(next)}` : "/login/admin"} className="text-muted-foreground underline" data-testid="admin-signin-link">Admin sign-in</Link></p>
    </div>
  );
}

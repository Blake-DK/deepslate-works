import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadCurrentUser } from "@/server/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { GENERIC_FAILURE, LOCKED_MESSAGE } from "@/server/auth/admin-core";
import { adminLogin } from "../actions";

export const metadata: Metadata = { title: "Admin sign-in" };

const MESSAGES: Record<string, { tone: "error" | "success"; text: string }> = {
  failed: { tone: "error", text: GENERIC_FAILURE },
  locked: { tone: "error", text: LOCKED_MESSAGE },
  link: { tone: "error", text: "That sign-in link has been used, has run out (15 minutes), or is not right. Make a new one." },
  changed: { tone: "success", text: "Password changed. Sign in with the new one." },
};

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; changed?: string; next?: string }> }) {
  if (await loadCurrentUser()) redirect("/");
  const { error, changed, next } = await searchParams;
  const msg = MESSAGES[changed ? "changed" : (error ?? "")] ?? (error ? MESSAGES.failed : null);
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      {msg && <Alert tone={msg.tone} data-testid="admin-signin-message">{msg.text}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Admin sign-in</CardTitle>
          <CardDescription>For admins who set up password sign-in. Everyone else: <Link href="/login" className="underline">continue with Discord</Link>.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={adminLogin} className="space-y-3" data-testid="admin-signin">
            <input type="hidden" name="next" value={next ?? "/"} />
            <div>
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" autoComplete="username" autoCapitalize="none" required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <div>
              <Label htmlFor="code">Code from your authenticator app</Label>
              <Input id="code" name="code" autoComplete="one-time-code" inputMode="text" required />
              <p className="mt-1 text-xs text-muted-foreground">6 digits, or one of your recovery codes.</p>
            </div>
            <Button type="submit" className="w-full">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

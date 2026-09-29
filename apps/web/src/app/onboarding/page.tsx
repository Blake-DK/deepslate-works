import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Set up" };

const ERRORS: Record<string, string> = { tier: "Pick the option closest to your PC.", form: "Check the form and try again." };

const TIERS = [
  { value: "LOW", title: "Older laptop or no graphics card", hint: "8 GB RAM or less, integrated graphics. We'll keep the pack light for you." },
  { value: "MID", title: "Normal desktop or gaming laptop", hint: "8 to 16 GB RAM, a graphics card of some kind." },
  { value: "HIGH", title: "Proper gaming PC", hint: "16 GB RAM or more and a decent graphics card." },
] as const;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const user = await requireUser();
  const { error, next } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Hi {user.displayName}, one quick thing</h1>
      {error && <Alert tone="error">{ERRORS[error] ?? ERRORS.form}</Alert>}
      <form action={completeOnboarding} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/"} />
        <Card>
          <CardHeader>
            <CardTitle>Your PC</CardTitle>
            <CardDescription>So the installer and the mod list can go easy on weaker machines. You can change it later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {TIERS.map((t) => (
              <label key={t.value} className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="pcTier" value={t.value} defaultChecked={user.pcTier === t.value || (!user.pcTier && t.value === "MID")} className="mt-1" required />
                <span>
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-sm text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">No Minecraft username needed: the first time you join the server, a link in the game chat connects your Minecraft account to this one.</p>
        <Button type="submit" size="lg" className="w-full">Done</Button>
      </form>
    </div>
  );
}

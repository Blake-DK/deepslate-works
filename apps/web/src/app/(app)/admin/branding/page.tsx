import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { BrandingForm } from "./form";
import { saveBrandingAction } from "./actions";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; note?: string; renamed?: string }> }) {
  await requireAdmin();
  const [{ saved, error, note, renamed }, b] = await Promise.all([searchParams, getBranding()]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Branding</h1>
        <p className="text-muted-foreground">How the site looks and what it is called. Changes show on the next page anyone opens; nothing needs rebuilding.</p>
      </div>
      {saved && <Alert tone="success">Saved. {note}</Alert>}
      {saved && renamed && <Alert>The installer carries the name it was built with. To put the new name in the launcher profile, press <Link href="/admin/modpack" className="underline">Build</Link> on the Modpack page; players get it the next time they run the installer.</Alert>}
      {error && <Alert tone="error">Not saved. {error}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Look and wording</CardTitle>
          <CardDescription>The preview on the right follows what you type. Used by the top bar, the sign-in and invite pages, the page titles, the rules page and the welcome line in game.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm action={saveBrandingAction} initial={{ name: b.name, tagline: b.tagline, accent: b.accent, accentDark: b.accentDark, defaultTheme: b.defaultTheme, discordInvite: b.discordInvite, footer: b.footer, rules: b.rules, motd: b.motd, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, bannerUrl: b.bannerUrl }} />
        </CardContent>
      </Card>
    </div>
  );
}

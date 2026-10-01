import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { getGuideSource } from "@/server/guide";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { BrandingForm } from "./form";
import { saveBrandingAction } from "./actions";
import { LogoPicker } from "./logo-picker";
import { listOptions } from "@/server/logo-options";
import { apiFetch } from "@/server/api-client";

export default async function BrandingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; note?: string; renamed?: string }> }) {
  const admin = await requireAdmin();
  const [{ saved, error, note, renamed }, b, guide, options, motd] = await Promise.all([
    searchParams, getBranding(), getGuideSource(), listOptions(),
    apiFetch<{ current: string | null; allowed: boolean | null; permission: string }>("/branding/motd", { caller: { id: admin.id, role: "ADMIN" }, timeoutMs: 8000 }).catch(() => null),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Branding</h2>
        <p className="text-muted-foreground">How the site looks and what it is called. Changes show on the next page anyone opens; nothing needs rebuilding.</p>
      </div>
      {saved && <Alert tone="success">Saved. {note}</Alert>}
      {saved && renamed && <Alert>The installer carries the name it was built with. To put the new name in the launcher profile, press <Link href="/admin/pack" className="underline">Build</Link> on the Pack page; players get it the next time they run the installer.</Alert>}
      {error && <Alert tone="error">Not saved. {error}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>Pick one of the eight, or upload your own. Nothing changes until you press &quot;Use this&quot;.</CardDescription>
        </CardHeader>
        <CardContent>
          <LogoPicker options={options} choice={b.logoChoice} ownUrl={b.logoChoice.startsWith("upload:") && b.generated ? b.generated.url(64) : null} ownPixel={b.generated?.pixel ?? false} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Look and wording</CardTitle>
          <CardDescription>The preview on the right follows what you type. Used by the top bar, the sign-in and invite pages, the page titles, the rules page and the welcome line in game.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm action={saveBrandingAction} initial={{ name: b.name, tagline: b.tagline, accent: b.accent, accentDark: b.accentDark, defaultTheme: b.defaultTheme, discordInvite: b.discordInvite, footer: b.footer, rules: b.rules, guide: guide.text, guideOwn: guide.own, motd: b.motd, motd2: b.motd2, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, bannerUrl: b.bannerUrl, logoPixel: b.generated?.pixel ?? false, icon64: b.generated ? b.generated.url(64) : null, motdAllowed: motd?.allowed ?? null, motdPermission: motd?.permission ?? "Settings.MinecraftModule.Minecraft.ServerMOTD" }} />
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { getGuideSource } from "@/server/guide";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { BrandingForm, type BrandingValues } from "./form";
import { saveBrandingAction } from "./actions";
import { LogoPicker } from "./logo-picker";
import { listOptions } from "@/server/logo-options";
import { apiFetch } from "@/server/api-client";

type Saved = { saved?: string; error?: string; note?: string; renamed?: string };

/** What the branding form starts from, whichever part of it a page shows. `motd` asks AMP whether the site may change the server list's lines. */
export async function brandingValues(adminId: string, motd = false): Promise<BrandingValues> {
  const [b, guide, amp] = await Promise.all([
    getBranding(), getGuideSource(),
    motd ? apiFetch<{ current: string | null; allowed: boolean | null; permission: string }>("/branding/motd", { caller: { id: adminId, role: "ADMIN" }, timeoutMs: 8000 }).catch(() => null) : null,
  ]);
  return { name: b.name, tagline: b.tagline, discordInvite: b.discordInvite, footer: b.footer, rules: b.rules, guide: guide.text, guideOwn: guide.own, motd: b.motd, motd2: b.motd2, logoUrl: b.logoUrl, faviconUrl: b.faviconUrl, bannerUrl: b.bannerUrl, logoPixel: b.generated?.pixel ?? false, icon64: b.generated ? b.generated.url(64) : null, motdAllowed: amp?.allowed ?? null, motdPermission: amp?.permission ?? "Settings.MinecraftModule.Minecraft.ServerMOTD" };
}

/** The line a branding save leaves behind (`?saved=1&note=…`, `?error=…`), on whichever page its form sits. */
export function BrandingSaved({ saved, error, note, renamed }: Saved) {
  return (
    <>
      {saved && <Alert tone="success">Saved. {note}</Alert>}
      {saved && renamed && <Alert>The installer carries the name it was built with. To put the new name in the launcher profile, press <Link href="/admin/pack" className="underline">Build</Link> on the Modpack page; players get it the next time they run the installer.</Alert>}
      {error && <Alert tone="error">Not saved. {error}</Alert>}
    </>
  );
}

/** Site → Look (the logo, the name and words, the sign-in banner) and Site → Pages (the Rules and Guide texts): docs/35. */
export default async function BrandingSection({ searchParams, part }: { searchParams: Promise<Saved>; part: "look" | "pages" }) {
  const admin = await requireAdmin();
  const [q, b, options, initial] = await Promise.all([searchParams, getBranding(), listOptions(), brandingValues(admin.id)]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{part === "look" ? "Look" : "Pages"}</h2>
        <p className="text-muted-foreground">{part === "look" ? "How the site looks and what it is called. Changes show on the next page anyone opens; nothing needs rebuilding." : "The two texts members read under Getting started. Changes show on the next page anyone opens."}</p>
      </div>
      <BrandingSaved {...q} />
      {part === "look" && (
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>Pick one of the eight, or upload your own. Nothing changes until you press &quot;Use this&quot;.</CardDescription>
          </CardHeader>
          <CardContent>
            <LogoPicker options={options} choice={b.logoChoice} ownUrl={b.logoChoice.startsWith("upload:") && b.generated ? b.generated.url(64) : null} ownPixel={b.generated?.pixel ?? false} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{part === "look" ? "Name, words and banner" : "Rules and guide"}</CardTitle>
          <CardDescription>{part === "look"
            ? <>The preview on the right follows what you type. Used by the top bar, the sign-in and invite pages, the page titles and the welcome line in game. The server list&apos;s two lines are on <Link href="/admin/server?tab=world" className="underline">Server → World &amp; map</Link>; the Discord invite link is on <Link href="/admin/discord" className="underline">Discord</Link>.</>
            : <>The Rules page and the Guide page, in Markdown.</>}</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm action={saveBrandingAction} initial={initial} part={part} />
        </CardContent>
      </Card>
    </div>
  );
}

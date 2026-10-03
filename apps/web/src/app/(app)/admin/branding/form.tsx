"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { MotdPreview } from "@/components/admin/motd-preview";
import { visible } from "@/lib/motd";

export type BrandingValues = {
  name: string; tagline: string;
  discordInvite: string; footer: string; rules: string; guide: string; guideOwn: boolean; motd: string; motd2: string;
  logoUrl: string | null; faviconUrl: string | null; bannerUrl: string | null; logoPixel: boolean; icon64: string | null;
  /** AMP's own MOTD setting may be changed by the site (permission), and what it holds now */
  motdAllowed: boolean | null; motdPermission: string;
};

const MAX = 2 * 1024 * 1024;

function Picture({ slot, label, hint, current, onPick }: { slot: string; label: string; hint: string; current: string | null; onPick: (url: string | null) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Label htmlFor={slot}>{label}</Label>
      <input
        id={slot} name={slot} type="file" accept="image/png,image/webp,image/svg+xml,.png,.webp,.svg"
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return onPick(null);
          if (f.size > MAX) {
            setProblem(`That file is ${(f.size / 1048576).toFixed(1)} MB. The most is 2 MB.`);
            e.target.value = "";
            return onPick(null);
          }
          setProblem(null);
          onPick(URL.createObjectURL(f));
        }}
      />
      <p className="text-xs text-muted-foreground">{hint} PNG, WebP or SVG, 2 MB at most.</p>
      {problem && <p className="text-xs text-danger" role="alert">{problem}</p>}
      {current && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name={`${slot}Remove`} className="h-3.5 w-3.5" /> Remove the current one</label>}
    </div>
  );
}

export function BrandingForm({ initial, action }: { initial: BrandingValues; action: (f: FormData) => Promise<void> }) {
  const [v, setV] = useState(initial);
  const [pics, setPics] = useState<{ logo: string | null; banner: string | null }>({ logo: null, banner: null });
  const set = (k: keyof BrandingValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const logo = pics.logo ?? v.logoUrl;
  const banner = pics.banner ?? v.bannerUrl;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Name and words</legend>
          <div><Label htmlFor="name">Server name</Label><Input id="name" name="name" value={v.name} onChange={set("name")} maxLength={40} required /></div>
          <div><Label htmlFor="tagline">Tagline</Label><Input id="tagline" name="tagline" value={v.tagline} onChange={set("tagline")} maxLength={120} /><p className="mt-1 text-xs text-muted-foreground">Under the name on the sign-in page and Home, at the foot of every page, in link previews, on the entrance room&apos;s sign and in the first chat line on joining.</p></div>
          <div><Label htmlFor="footer">Footer text</Label><Input id="footer" name="footer" value={v.footer} onChange={set("footer")} maxLength={200} /></div>
          <div><Label htmlFor="discordInvite">Discord invite link</Label><Input id="discordInvite" name="discordInvite" type="url" value={v.discordInvite} onChange={set("discordInvite")} maxLength={200} placeholder="https://discord.gg/…" /></div>
          <div className="space-y-2">
            <Label htmlFor="motd">Server description (two lines in the server list)</Label>
            <Input id="motd" name="motd" value={v.motd} onChange={set("motd")} maxLength={120} className="font-mono" />
            <Input id="motd2" name="motd2" aria-label="Second line" value={v.motd2} onChange={set("motd2")} maxLength={120} className="font-mono" />
            <MotdPreview name={v.name} line1={v.motd} line2={v.motd2} icon={v.icon64} pixel={v.logoPixel} />
            {[v.motd, v.motd2].some((l) => visible(l).length > 45) && <p className="text-xs text-primary">A line longer than about 45 characters is cut off in the game.</p>}
            <p className="text-xs text-muted-foreground">Colours with Minecraft&apos;s codes: <span className="font-mono">§8</span> dark grey, <span className="font-mono">§7</span> grey, <span className="font-mono">§6</span> orange, <span className="font-mono">§f</span> white, <span className="font-mono">§l</span> bold, <span className="font-mono">§r</span> back to normal. Saving sends it to AMP, which puts it on the server at the <strong>next server start</strong>.{v.motdAllowed === false && <> AMP does not let the site change it yet: give the AMP user <span className="font-mono">webapp</span> the permission <span className="font-mono">{v.motdPermission}</span>.</>}</p>
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Sign-in banner</legend>
          <p className="text-xs text-muted-foreground">The logo is picked in the Logo section above; every size is made from it.</p>
          <Picture slot="banner" label="Sign-in banner" hint="A wide picture above the sign-in box." current={v.bannerUrl} onPick={(u) => setPics((p) => ({ ...p, banner: u }))} />
          <p className="text-xs text-muted-foreground">SVGs are rebuilt from a list of plain drawing elements when you save: scripts, styles, links and anything pointing outside the file are removed. If a picture comes out wrong, export it as a plain SVG or use a PNG.</p>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Rules page</legend>
          <Label htmlFor="rules" className="sr-only">Rules</Label>
          <textarea id="rules" name="rules" value={v.rules} onChange={set("rules")} rows={10} maxLength={8000} className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"# House rules\n\n- No griefing\n- Ask before borrowing\n\nChat is kept for 30 days so admins can sort out disputes."} />
          <p className="text-xs text-muted-foreground"><span className="font-mono"># Heading</span>, <span className="font-mono">- list</span>, <span className="font-mono">**bold**</span>, <span className="font-mono">*italic*</span>, <span className="font-mono">[words](https://link)</span>. The page also lists what the site keeps about players, from the settings.</p>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Guide page</legend>
          <Label htmlFor="guide" className="sr-only">Guide</Label>
          <textarea id="guide" name="guide" value={v.guide} onChange={set("guide")} rows={16} maxLength={20000} className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <p className="text-xs text-muted-foreground">{v.guideOwn ? "This is your own text." : "This is the guide as it ships; change it and save to make it yours."} Same Markdown as the rules. A heading, a list item or a paragraph that ends in <span className="font-mono">&lt;!-- mod: create --&gt;</span> is shown only while that mod is switched on in the mod list; the name is the one in the mod&apos;s address on the Mods page. The numbered steps under &quot;Getting in&quot; are also shown on the sign-in page. Empty the box and save to get the shipped guide back.</p>
        </fieldset>
        <Button type="submit">Save branding</Button>
      </form>

      <aside aria-label="Preview" className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <h2 className="text-sm font-semibold">Preview</h2>
        <div className="overflow-hidden rounded-[4px] border bg-background text-sm text-foreground">
          <div className="flex items-center gap-2 border-b bg-panel px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the picked file */}
            {logo && <img src={logo} alt="" className="h-6 w-auto max-w-24 object-contain" />}
            <span className="font-semibold">{v.name || "…"}</span>
            <span className="ml-3 text-xs text-muted-foreground">Home · Mods · Map</span>
            <span className="ml-auto text-xs text-primary-hi">Admin</span>
          </div>
          <div className="space-y-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the picked file */}
            {banner && <img src={banner} alt="" className="max-h-28 w-full border object-cover" />}
            <div className="rounded-[4px] border bg-card p-3">
              <p className="font-semibold">Sign in</p>
              <p className="text-xs text-muted-foreground">Already in the group? Continue with the account you joined with.</p>
              <span className="block-btn block-play mt-2 inline-flex h-9 items-center text-sm font-semibold [--px:16px]">Continue with Discord</span>
              <span className="ml-2 rounded-[3px] border bg-card-2 px-2 py-px text-[13px] font-semibold text-warn">Pinned</span>
            </div>
            <p className="text-center text-xs text-muted-foreground">{v.tagline}{(v.footer || v.discordInvite) && <><br />{v.footer}{v.footer && v.discordInvite ? " · " : ""}{v.discordInvite && <span className="underline">Discord</span>}</>}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">In game, the first line on joining reads: <span className="font-mono">{v.name || "…"}{v.tagline ? ` · ${v.tagline}` : ""}</span></p>
      </aside>
    </div>
  );
}

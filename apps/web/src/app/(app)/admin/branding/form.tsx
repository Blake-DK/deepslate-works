"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export type BrandingValues = {
  name: string; tagline: string; accent: string; accentDark: string; defaultTheme: "light" | "dark" | "system";
  discordInvite: string; footer: string; rules: string; motd: string;
  logoUrl: string | null; faviconUrl: string | null; bannerUrl: string | null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX = 2 * 1024 * 1024;

/** Contrast of white (or near-black) text on the colour, as WCAG works it out. */
function contrast(hex: string, on: "light" | "dark"): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  const text = on === "light" ? 1 : 0.0086; // white on the light theme's button, #16171a on the dark theme's
  return (Math.max(l, text) + 0.05) / (Math.min(l, text) + 0.05);
}

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
  const [look, setLook] = useState<"light" | "dark">("light");
  useEffect(() => setLook(document.documentElement.dataset.theme === "dark" ? "dark" : "light"), []);
  const set = (k: keyof BrandingValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const accent = look === "dark" ? v.accentDark : v.accent;
  const okAccent = HEX.test(accent) ? accent : look === "dark" ? "#d9823f" : "#b8652c";
  const ratio = useMemo(() => contrast(okAccent, look), [okAccent, look]);
  const logo = pics.logo ?? v.logoUrl;
  const banner = pics.banner ?? v.bannerUrl;
  const palette = look === "dark" ? { bg: "#16171a", card: "#202226", fg: "#ebe9e4", muted: "#a09d95", border: "#33363c", on: "#16171a" } : { bg: "#f6f5f2", card: "#ffffff", fg: "#1c1b19", muted: "#6b6862", border: "#dedbd3", on: "#ffffff" };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Name and words</legend>
          <div><Label htmlFor="name">Server name</Label><Input id="name" name="name" value={v.name} onChange={set("name")} maxLength={40} required /></div>
          <div><Label htmlFor="tagline">Tagline</Label><Input id="tagline" name="tagline" value={v.tagline} onChange={set("tagline")} maxLength={120} /><p className="mt-1 text-xs text-muted-foreground">Shown at the foot of every page.</p></div>
          <div><Label htmlFor="footer">Footer text</Label><Input id="footer" name="footer" value={v.footer} onChange={set("footer")} maxLength={200} /></div>
          <div><Label htmlFor="discordInvite">Discord invite link</Label><Input id="discordInvite" name="discordInvite" type="url" value={v.discordInvite} onChange={set("discordInvite")} maxLength={200} placeholder="https://discord.gg/…" /></div>
          <div><Label htmlFor="motd">Message in the server list</Label><Input id="motd" name="motd" value={v.motd} onChange={set("motd")} maxLength={59} /><p className="mt-1 text-xs text-muted-foreground">What Minecraft shows under the server&apos;s name. The site cannot change it on the server: AMP writes that setting itself. Admin → Files shows whether the server matches; change it in AMP.</p></div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Colours</legend>
          <div className="grid grid-cols-2 gap-3">
            {(["accent", "accentDark"] as const).map((k) => (
              <div key={k}>
                <Label htmlFor={k}>{k === "accent" ? "Accent, light theme" : "Accent, dark theme"}</Label>
                <div className="flex gap-2">
                  <input type="color" aria-label={`${k === "accent" ? "Light" : "Dark"} theme accent, colour picker`} value={HEX.test(v[k]) ? v[k] : "#000000"} onChange={set(k)} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border bg-background p-1" />
                  <Input id={k} name={k} value={v[k]} onChange={set(k)} pattern="#[0-9a-fA-F]{6}" maxLength={7} required className="font-mono" />
                </div>
              </div>
            ))}
          </div>
          <div className="max-w-xs"><Label htmlFor="defaultTheme">Theme for a first visit</Label>
            <Select id="defaultTheme" name="defaultTheme" value={v.defaultTheme} onChange={set("defaultTheme")}><option value="system">Follow their device</option><option value="light">Light</option><option value="dark">Dark</option></Select>
            <p className="mt-1 text-xs text-muted-foreground">Once someone uses the ☾ switch, their choice wins.</p>
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Pictures</legend>
          <Picture slot="logo" label="Logo" hint="Shown in the top bar and on the sign-in page." current={v.logoUrl} onPick={(u) => setPics((p) => ({ ...p, logo: u }))} />
          <Picture slot="banner" label="Sign-in banner" hint="A wide picture above the sign-in box." current={v.bannerUrl} onPick={(u) => setPics((p) => ({ ...p, banner: u }))} />
          <Picture slot="favicon" label="Browser tab icon" hint="Square works best." current={v.faviconUrl} onPick={() => {}} />
          <p className="text-xs text-muted-foreground">SVGs are rebuilt from a list of plain drawing elements when you save: scripts, styles, links and anything pointing outside the file are removed. If a picture comes out wrong, export it as a plain SVG or use a PNG.</p>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Rules page</legend>
          <Label htmlFor="rules" className="sr-only">Rules</Label>
          <textarea id="rules" name="rules" value={v.rules} onChange={set("rules")} rows={10} maxLength={8000} className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder={"# House rules\n\n- No griefing\n- Ask before borrowing\n\nChat is kept for 30 days so admins can sort out disputes."} />
          <p className="text-xs text-muted-foreground"><span className="font-mono"># Heading</span>, <span className="font-mono">- list</span>, <span className="font-mono">**bold**</span>, <span className="font-mono">*italic*</span>, <span className="font-mono">[words](https://link)</span>. The page also lists what the site keeps about players, from the settings.</p>
        </fieldset>
        <Button type="submit">Save branding</Button>
      </form>

      <aside aria-label="Preview" className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Preview</h2>
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
            {(["light", "dark"] as const).map((t) => <button key={t} type="button" onClick={() => setLook(t)} aria-pressed={look === t} className={`rounded-md px-2 py-1 ${look === t ? "bg-card font-medium shadow-sm" : ""}`}>{t === "light" ? "Light" : "Dark"}</button>)}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border text-sm" style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}>
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ background: palette.card, borderColor: palette.border }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the picked file */}
            {logo && <img src={logo} alt="" className="h-6 w-auto max-w-24 object-contain" />}
            <span className="font-semibold">{v.name || "…"}</span>
            <span className="ml-3 text-xs" style={{ color: palette.muted }}>Home · Mods · Map</span>
            <span className="ml-auto text-xs" style={{ color: okAccent }}>Admin</span>
          </div>
          <div className="space-y-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the picked file */}
            {banner && <img src={banner} alt="" className="max-h-28 w-full rounded-lg border object-cover" style={{ borderColor: palette.border }} />}
            <div className="rounded-lg border p-3" style={{ background: palette.card, borderColor: palette.border }}>
              <p className="font-semibold">Sign in</p>
              <p className="text-xs" style={{ color: palette.muted }}>Already in the group? Continue with the account you joined with.</p>
              <span className="mt-2 inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium" style={{ background: okAccent, color: palette.on }}>Continue with Discord</span>
              <span className="ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: `${okAccent}26`, color: okAccent }}>Pinned</span>
            </div>
            <p className="text-center text-xs" style={{ color: palette.muted }}>{v.tagline}{(v.footer || v.discordInvite) && <><br />{v.footer}{v.footer && v.discordInvite ? " · " : ""}{v.discordInvite && <span className="underline">Discord</span>}</>}</p>
          </div>
        </div>
        <p className={`text-xs ${ratio < 3 ? "text-danger" : "text-muted-foreground"}`} role={ratio < 3 ? "alert" : undefined}>
          Button text on this colour: contrast {ratio.toFixed(1)} to 1. {ratio < 3 ? "Hard to read. Pick a darker colour for the light theme, or a lighter one for the dark theme." : ratio < 4.5 ? "Fine for buttons; a little low for small text." : "Easy to read."}
        </p>
        <p className="text-xs text-muted-foreground">In game, a new player&apos;s welcome line will read: <span className="font-mono">Welcome to {v.name || "…"}. Click to link your Discord: …</span></p>
      </aside>
    </div>
  );
}

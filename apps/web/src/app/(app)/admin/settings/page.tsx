import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { getManifest } from "@/server/modpack/manifest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { launchText } from "@/components/launch-banner";
import { getSection } from "@/server/site-settings";
import { saveFilesAction, savePrivacyAction, saveRetentionAction, saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  // Show the stored instant as UK wall-clock time in the datetime-local box.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const SECTION: Record<string, string> = { privacy: "Privacy", retention: "How long things are kept", files: "File browser", "1": "Launch" };

function Tick({ name, checked, title, children }: { name: string; checked: boolean; title: string; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 h-5 w-5 accent-[var(--primary)]" />
      <span><span className="block font-medium">{title}</span><span className="block text-sm text-muted-foreground">{children}</span></span>
    </label>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; detail?: string }> }) {
  const [{ saved, error, detail }, settings, manifest, privacy, retention, files] = await Promise.all([searchParams, getSettings(), getManifest(), getSection("privacy"), getSection("retention"), getSection("files")]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {saved && <Alert tone="success">Saved{SECTION[saved] ? `: ${SECTION[saved]}` : ""}.</Alert>}
      {error && <Alert tone="error">{error === "form" ? "Check the launch date and try again." : <>Not saved ({SECTION[error] ?? error}). {detail}</>}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Launch {settings.live ? <Badge tone="good">live</Badge> : <Badge tone="warn">not live</Badge>}</CardTitle>
          <CardDescription>
            Until you flip this, players never see the server address (<span className="font-mono">{manifest.server_address}</span>) or the installer and pack downloads; the Install and Home pages show the launch date instead. Once live, downloads open whenever the server is running. Admins always see everything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSettingsAction} className="space-y-4">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
              <input type="checkbox" name="live" defaultChecked={settings.live} className="h-5 w-5 accent-[var(--primary)]" />
              <span><span className="block font-medium">We&apos;re live</span><span className="block text-sm text-muted-foreground">Unlocks the address and downloads for players.</span></span>
            </label>
            <div className="max-w-xs">
              <Label htmlFor="launchAt">Launch date (UK time, optional)</Label>
              <Input id="launchAt" name="launchAt" type="datetime-local" defaultValue={toLocalInput(settings.launchAt)} />
              <p className="mt-1 text-xs text-muted-foreground">Players see: &quot;{launchText(settings.launchAt)}&quot;. Leave empty for &quot;to be announced&quot;.</p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>What the site keeps about the people who play. Changes take effect within half a minute.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={savePrivacyAction} className="space-y-3">
            <Tick name="geo" checked={privacy.geo} title="Work out which country players connect from">Used for the countries panel on the analytics page. Looked up in a file on this server; nothing is sent anywhere. The address itself is only ever visible to admins. Off: the panel says &quot;Location off&quot;.</Tick>
            <Tick name="chat" checked={privacy.chat} title="Keep chat in the event log">In-game chat lines are stored so admins can read back what was said. Say so on the rules page. Off: chat is not stored at all.</Tick>
            <Tick name="analyticsForPlayers" checked={privacy.analyticsForPlayers} title="Players can see the analytics page">Play time, sessions and who plays when, for everyone in the group. Addresses and console lines are never shown to players.</Tick>
            <Button type="submit">Save privacy</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>How long things are kept</CardTitle>
          <CardDescription>Cleared once a day. What admins did is kept for good.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveRetentionAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><Label htmlFor="chatDays">Chat, days</Label><Input id="chatDays" name="chatDays" type="number" min={1} max={3650} defaultValue={retention.chatDays} required /></div>
              <div><Label htmlFor="eventDays">Other events, days</Label><Input id="eventDays" name="eventDays" type="number" min={7} max={3650} defaultValue={retention.eventDays} required /></div>
              <div><Label htmlFor="ipDays">Players&apos; addresses, days</Label><Input id="ipDays" name="ipDays" type="number" min={1} max={365} defaultValue={retention.ipDays} required /></div>
              <div><Label htmlFor="installDays">Install reports, days</Label><Input id="installDays" name="installDays" type="number" min={1} max={3650} defaultValue={retention.installDays} required /></div>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>File browser</CardTitle>
          <CardDescription>Limits for Admin → Files. The browser can only read; nothing here allows changing files on the server.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveFilesAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="maxDownloadMb">Largest download, MB</Label><Input id="maxDownloadMb" name="maxDownloadMb" type="number" min={1} max={500} defaultValue={files.maxDownloadMb} required /></div>
              <div><Label htmlFor="maxPreviewKb">Largest preview, KB</Label><Input id="maxPreviewKb" name="maxPreviewKb" type="number" min={16} max={8192} defaultValue={files.maxPreviewKb} required /></div>
            </div>
            <div>
              <Label htmlFor="denied">Never shown or downloaded (one per line)</Label>
              <textarea id="denied" name="denied" rows={8} defaultValue={files.denied.join("\n")} className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <p className="mt-1 text-xs text-muted-foreground"><span className="font-mono">name/</span> is a folder anywhere in the tree and everything in it; <span className="font-mono">*</span> stands for any part of a name. The world, player data and backups are on the list for a reason: they are large, and they hold everyone&apos;s inventories and positions.</p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

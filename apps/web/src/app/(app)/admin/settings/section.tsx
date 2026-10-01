import { dateToUkLocal } from "@/lib/uk-time";
import { getSettings } from "@/server/settings";
import { getManifest } from "@/server/modpack/manifest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { launchText } from "@/components/launch-banner";
import { getSection } from "@/server/site-settings";
import { serverPack } from "@/server/play";
import { saveFilesAction, savePrivacyAction, saveRetentionAction, saveSettingsAction, saveJoiningAction } from "./actions";

// Show the stored instant as UK wall-clock time in the datetime-local box.
const toLocalInput = dateToUkLocal;

const SECTION: Record<string, string> = { privacy: "Privacy", retention: "How long things are kept", files: "File browser", joining: "Joining", "1": "Launch" };

function Tick({ name, checked, title, children }: { name: string; checked: boolean; title: string; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 h-5 w-5 accent-[var(--primary)]" />
      <span><span className="block font-medium">{title}</span><span className="block text-sm text-muted-foreground">{children}</span></span>
    </label>
  );
}

/** Site settings' first five tabs (docs/13 §11 layout): one card each. `tab` picks which. */
export default async function SettingsPage({ searchParams, tab }: { searchParams: Promise<{ saved?: string; error?: string; detail?: string }>; tab: "launch" | "joining" | "privacy" | "kept" | "files" }) {
  const show = (t: typeof tab) => t === tab;
  const [{ saved, error, detail }, settings, manifest, privacy, retention, files, joining, pack] = await Promise.all([searchParams, getSettings(), getManifest(), getSection("privacy"), getSection("retention"), getSection("files"), getSection("joining"), serverPack()]);
  return (
    <div className="space-y-4">
      {saved && <Alert tone="success">Saved{SECTION[saved] ? `: ${SECTION[saved]}` : ""}.</Alert>}
      {error && <Alert tone="error">{error === "form" ? "Check the launch date and try again." : <>Not saved ({SECTION[error] ?? error}). {detail}</>}</Alert>}
      {show("launch") && (
        <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Launch {settings.live ? <Badge tone="good">live</Badge> : <Badge tone="warn">not live</Badge>}</CardTitle>
          <CardDescription>
            Until you flip this, players never see the server address (<span className="font-mono">{manifest.server_address}</span>) or the installer and pack downloads; Home and Getting started show the launch date instead. Once live, downloads open whenever the server is running. Admins always see everything.
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
      )}
      {show("joining") && (
        <Card>
        <CardHeader>
          <CardTitle>Joining</CardTitle>
          <CardDescription>Members press Play on the site before they join, so that their mods are the server&apos;s. Whoever has not is kept in the entrance room with a line that says so, and is let through, back to where they stood, within seconds of pressing it. Admins are never kept. The server runs <span className="font-mono">{pack ?? "a pack nobody has written down yet (it is after the next sync)"}</span>.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveJoiningAction} className="space-y-3">
            <Tick name="requirePlay" checked={joining.requirePlay} title="Play first">Off: every linked member comes straight in, as before. Switch it off if the site&apos;s reports ever stop arriving; nobody could join otherwise.</Tick>
            <div className="max-w-xs">
              <Label htmlFor="windowMin">A run of Play counts for, minutes</Label>
              <Input id="windowMin" name="windowMin" type="number" min={5} max={1440} defaultValue={joining.windowMin} required />
            </div>
            <div className="max-w-xs">
              <Label htmlFor="minInstaller">Minimum installer version</Label>
              <Input id="minInstaller" name="minInstaller" defaultValue={joining.minInstaller} pattern="(\d{1,4}(\.\d{1,4}){1,3})?" placeholder="1.5.0" />
              <p className="mt-1 text-xs text-muted-foreground">A run of Play from an older installer does not count: the member is held with &quot;Download Deepslate Works again from deepslate.dsw.test/install&quot;. Empty: any installer. Admins are never held.</p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
        </Card>
      )}
      {show("privacy") && (
        <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>What the site keeps about the people who play. Changes take effect within half a minute.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={savePrivacyAction} className="space-y-3">
            <Tick name="geo" checked={privacy.geo} title="Work out which country players connect from">Used for the countries panel on the analytics page. Looked up in a file on this server; nothing is sent anywhere. The address itself is only ever visible to admins. Off: the panel says &quot;Location off&quot;.</Tick>
            <Tick name="chat" checked={privacy.chat} title="Keep chat in the event log">In-game chat lines are stored so admins can read back what was said. Say so on the rules page. Off: chat is not stored at all.</Tick>
            <Tick name="analyticsForPlayers" checked={privacy.analyticsForPlayers} title="Players can see the Stats tab">Play time, sessions and who plays when, for everyone in the group. Addresses and console lines are never shown to players. Off: the Stats tab is hidden for players.</Tick>
            <Button type="submit">Save privacy</Button>
          </form>
        </CardContent>
        </Card>
      )}
      {show("kept") && (
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
      )}
      {show("files") && (
        <Card>
        <CardHeader>
          <CardTitle>File browser</CardTitle>
          <CardDescription>Limits for Admin → Server → Files. The browser can only read; nothing here allows changing files on the server.</CardDescription>
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
      )}
    </div>
  );
}

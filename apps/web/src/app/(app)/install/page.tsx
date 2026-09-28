import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireOnboardedUser } from "@/server/auth/session";
import { getManifest } from "@/server/modpack/manifest";
import { distFile, getLock } from "@/server/modpack/lock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { canDownload } from "@/server/modpack/gate";
import { canSeeServer, getSettings } from "@/server/settings";
import { LaunchBanner } from "@/components/launch-banner";

export const metadata: Metadata = { title: "Install" };

function detectOs(ua: string): "windows" | "mac" | "linux" | "other" {
  if (/windows/i.test(ua)) return "windows";
  if (/mac os|macintosh/i.test(ua)) return "mac";
  if (/linux|x11/i.test(ua) && !/android/i.test(ua)) return "linux";
  return "other";
}

export default async function InstallPage({ searchParams }: { searchParams: Promise<{ os?: string; offline?: string }> }) {
  const user = await requireOnboardedUser();
  const { os: osParam, offline } = await searchParams;
  const ua = (await headers()).get("user-agent") ?? "";
  const os = osParam === "windows" || osParam === "mac" ? osParam : detectOs(ua);
  const [m, lock, installer, mrpack] = await Promise.all([getManifest(), getLock(), distFile("installer.zip"), distFile("client.mrpack")]);
  const version = lock ? `${m.version}+${lock.hash.slice(0, 8)}` : null;
  const settings = await getSettings();
  const showServer = canSeeServer(user, settings);
  const gate = await canDownload(user);
  const ready = Boolean(lock && installer && mrpack) && gate.ok;
  const windows = os === "windows";
  const rd = user.pcTier === "HIGH" ? 12 : user.pcTier === "MID" ? 10 : 8;

  if (!showServer) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Join the server</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">Not open yet. When it launches, this page turns into a one-click installer for Windows and a two-step guide for Mac and Linux, and the server address appears here.</p>
        </div>
        <LaunchBanner launchAt={settings.launchAt} admin={false} />
        <Card>
          <CardHeader>
            <CardTitle>Meanwhile</CardTitle>
            <CardDescription>Have the normal Minecraft Launcher installed and opened once (Java Edition 1.21.1), read the mod list, and cast your vote if one is open.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!settings.live && <LaunchBanner launchAt={settings.launchAt} admin />}
      <div>
        <h1 className="text-2xl font-semibold">Join the server</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          One download, one double-click. It installs into the normal Minecraft Launcher as its own profile and never touches your vanilla game.
          {version && <> Current pack: <span className="font-mono">{version}</span>{lock && <> · built {formatDate(new Date(lock.generatedAt))}</>}.</>}
        </p>
      </div>
      {!(lock && installer && mrpack) && <Alert tone="info">The pack hasn&apos;t been built yet. Alex will post in Discord when the download is up.</Alert>}
      {lock && installer && mrpack && !gate.ok && <Alert tone="info">Downloads open when the server is online. It&apos;s off right now (or the site can&apos;t reach it); check back later or ask in Discord.</Alert>}
      {offline && gate.ok && <Alert tone="info">The server was offline a moment ago; it&apos;s reachable now, try again.</Alert>}
      {gate.reason === "admin" && <Alert tone="info">Admin: downloads are always open for you. Players only see them while the server is online.</Alert>}

      <div className="flex gap-2 text-sm">
        <a href="/install?os=windows" className={buttonClasses(windows ? "primary" : "secondary", "sm")}>Windows</a>
        <a href="/install?os=mac" className={buttonClasses(!windows ? "primary" : "secondary", "sm")}>Mac / Linux</a>
      </div>

      {windows ? (
        <Card>
          <CardHeader>
            <CardTitle>Windows: three steps</CardTitle>
            <CardDescription>About five minutes, most of it downloading.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              <li className="rounded-lg border p-3"><span className="font-medium">1. Install the normal Minecraft Launcher</span> from <a className="underline" href="https://www.minecraft.net/download" target="_blank" rel="noreferrer">minecraft.net</a> if you don&apos;t have it, and open it once (log in, let it update, close it). Already have it? Skip this.</li>
              <li className="rounded-lg border p-3">
                <span className="font-medium">2. Download the installer, unzip it somewhere you&apos;ll keep (Desktop is fine), double-click <span className="font-mono">Setup.bat</span></span>. Your browser opens once to sign you in with Discord and asks &quot;is this you?&quot;: say yes. Then a black window shows green ticks.
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href="/downloads/installer.zip" className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")} aria-disabled={!ready}>Download installer{installer ? ` (${(installer.size / 1024).toFixed(0)} KB)` : ""}</a>
                  <span className="text-xs text-muted-foreground">Windows may warn about an unknown app: choose &quot;More info&quot; then &quot;Run anyway&quot;. It&apos;s a plain script; you can read it.</span>
                </div>
              </li>
              <li className="rounded-lg border p-3"><span className="font-medium">3. Open the Minecraft Launcher, pick &quot;{m.name}&quot;</span> in the dropdown next to Play, press Play. The server is already in your server list.</li>
            </ol>
            <p className="text-sm text-muted-foreground">From then on, double-click <span className="font-mono">Update and Play.bat</span> in the same folder: it signs you in with Discord in your browser the first time (then remembers you for a week), fetches any mod updates, and opens the launcher on the Deepslate Works profile. Keep the folder; that&apos;s your play button.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Mac and Linux: two steps</CardTitle>
            <CardDescription>The one-click installer is Windows only; this route takes a couple of minutes more.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              <li className="rounded-lg border p-3"><span className="font-medium">1. Install the Modrinth App</span> from <a className="underline" href="https://modrinth.com/app" target="_blank" rel="noreferrer">modrinth.com/app</a> and sign in with your Minecraft account.</li>
              <li className="rounded-lg border p-3">
                <span className="font-medium">2. Download the pack and drag it into the Modrinth App</span> (or use &quot;Import&quot;). Then press Play on the {m.name} card.
                <div className="mt-2"><a href="/downloads/client.mrpack" className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")} aria-disabled={!ready}>Download client.mrpack</a></div>
              </li>
            </ol>
            <p className="text-sm">Add the server by hand: Multiplayer → Add Server → address below. Set render distance to about {rd} for your PC.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Server address</CardTitle><CardDescription>The Windows installer adds it for you; everyone else copies it.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border bg-muted px-3 py-2 font-mono">{m.server_address}</span>
          <CopyButton text={m.server_address} label="Copy address" />
          <Badge>Minecraft {m.minecraft} · NeoForge {lock?.neoforge ?? "?"}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your PC</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You told us: <strong className="text-foreground">{user.pcTier === "LOW" ? "older laptop / no graphics card" : user.pcTier === "HIGH" ? "proper gaming PC" : "normal desktop or gaming laptop"}</strong>. The installer picks RAM automatically from what your PC has; if the game stutters, set render distance to {rd} in Video Settings.
        </CardContent>
      </Card>
    </div>
  );
}

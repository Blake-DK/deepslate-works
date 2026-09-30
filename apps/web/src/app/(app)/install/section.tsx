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
import { isWindows, WINDOWS_ONLY } from "@/lib/platform";
import { getPlayInfo } from "@/server/play";
import { PlayButton } from "@/components/server/play-button";
import { joinLine } from "@/lib/play";
import { clock } from "@/lib/utils";

export default async function InstallPage({ searchParams }: { searchParams: Promise<{ offline?: string }> }) {
  const user = await requireOnboardedUser();
  const { offline } = await searchParams;
  // Windows only (planner decision, 2026-09-29): any other browser gets one line and nothing else.
  if (!isWindows((await headers()).get("user-agent"))) {
    const name = (await getManifest()).name;
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Join the server</h2>
        <Alert tone="info">{WINDOWS_ONLY(name)}</Alert>
      </div>
    );
  }
  const [m, lock, installer, play] = await Promise.all([getManifest(), getLock(), distFile("installer.zip"), getPlayInfo(user)]);
  const version = lock ? `${m.version}+${lock.hash.slice(0, 8)}` : null;
  const settings = await getSettings();
  const showServer = canSeeServer(user, settings);
  const gate = await canDownload(user);
  const ready = Boolean(lock && installer) && gate.ok;
  const rd = user.pcTier === "HIGH" ? 12 : user.pcTier === "MID" ? 10 : 8;

  if (!showServer) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Join the server</h2>
          <p className="mt-1 max-w-2xl text-muted-foreground">Not open yet. When it launches, this page turns into a one-click installer for Windows, and the server address appears here.</p>
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
      {!settings.live && user.role === "ADMIN" && <LaunchBanner launchAt={settings.launchAt} admin />}
      <div>
        <h2 className="text-xl font-semibold">Join the server</h2>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          One download, one double-click. It installs into the normal Minecraft Launcher as its own profile and never touches your vanilla game.
          {version && <> Current pack: <span className="font-mono">{version}</span>{lock && <> · built {formatDate(new Date(lock.generatedAt))}</>}.</>}
        </p>
      </div>
      {!(lock && installer) && <Alert tone="info">The pack hasn&apos;t been built yet. Alex will post in Discord when the download is up.</Alert>}
      {lock && installer && !gate.ok && <Alert tone="info">Downloads open while the server is online, asleep or waking. Right now: <strong>{play.server.line}</strong>. {play.server.hint}</Alert>}
      {offline && gate.ok && <Alert tone="info">The server was offline a moment ago; it&apos;s reachable now, try again.</Alert>}
      {gate.reason === "admin" && <Alert tone="info">Admin: downloads are always open for you. Players only see them while the server is online, asleep or waking.</Alert>}

      <Card className="border-primary">
        <CardHeader>
          <CardTitle>Play</CardTitle>
          <CardDescription>Once installed, use the Play button here to launch. It checks for updates every time.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlayButton name={play.name} current={play.current} ready={play.ready} last={play.last ? { version: play.last.version, on: formatDate(play.last.at) } : null} update={play.update} join={joinLine(play.join ? (play.join.ok ? { ok: true, time: clock(play.join.until) } : play.join) : null)} stepsHere  server={play.server} wake={play.wake} installed={play.installed} />
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle>First time on this PC</CardTitle>
            <CardDescription>Download, double-click Setup.bat once. After that, just press Play here or open Deepslate Works from your desktop. It keeps itself up to date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              <li className="rounded-lg border p-3"><span className="font-medium">1. Install the normal Minecraft Launcher</span> from <a className="underline" href="https://www.minecraft.net/download" target="_blank" rel="noreferrer">minecraft.net</a> if you don&apos;t have it, and open it once (log in, let it update). Already have it? Skip this. <strong>Then close it completely</strong>: if its icon is still next to the clock, right-click the icon and choose Quit. While the launcher is open it throws the new profile away; Deepslate Works checks and tells you.</li>
              <li className="rounded-lg border p-3">
                <span className="font-medium">2. Download, unzip, double-click <span className="font-mono">Setup.bat</span> once</span>. Your browser opens to sign you in with Discord and asks &quot;is this you?&quot;: say yes. A window installs everything (about five minutes, most of it downloading), puts &quot;{m.name}&quot; on your desktop and in the Start Menu, and opens the Minecraft Launcher on the &quot;{m.name}&quot; profile: press Play there. You can delete the zip afterwards.
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href="/downloads/installer.zip" className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")} aria-disabled={!ready}>Download{installer ? ` (${(installer.size / 1024).toFixed(0)} KB)` : ""}</a>
                  <span className="text-xs text-muted-foreground">Windows may warn about an unknown app: choose &quot;More info&quot; then &quot;Run anyway&quot;. It&apos;s a plain script; you can read it.</span>
                </div>
              </li>
            </ol>
            <p className="text-sm text-muted-foreground">After that, just press Play here or open {m.name} from your desktop. It keeps itself and the mods up to date, then opens the launcher. The first time you press Play here your browser asks whether this site may open Windows PowerShell: say yes, and tick &quot;always allow&quot; if you like. The server is already in your server list.</p>
          </CardContent>
        </Card>

      <Card>
        <CardHeader><CardTitle>Server address</CardTitle><CardDescription>The installer adds it to your server list; here it is in case you need it.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg border bg-muted px-3 py-2 font-mono">{m.server_address}</span>
          <CopyButton text={m.server_address} label="Copy address" />
          <Badge>Minecraft {m.minecraft} · NeoForge {lock?.neoforge ?? "?"}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your PC</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {user.pcTierSource === "measured" ? "The installer measured your PC" : "You told us"}: <strong className="text-foreground">{user.pcTier === "LOW" ? "older laptop / no graphics card" : user.pcTier === "HIGH" ? "proper gaming PC" : "normal desktop or gaming laptop"}</strong>{user.pcTierSource === "measured" && user.pcTierWhy ? <> ({user.pcTierWhy})</> : null}. The installer picks RAM automatically from what your PC has{user.pcTierSource === "measured" ? "" : ", and checks what kind of PC it is when it runs"}; if the game stutters, set render distance to {rd} in Video Settings.
        </CardContent>
      </Card>

      <Card data-testid="uninstall-help">
        <CardHeader><CardTitle>Removing {m.name}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Close the Minecraft Launcher first. Then either open Windows <strong className="text-foreground">Settings → Apps</strong>, find &quot;{m.name}&quot; and choose Uninstall, or open <strong className="text-foreground">Uninstall {m.name}</strong> from the Start Menu. It asks once, then removes the mods, its own files, the launcher profile, the shortcuts and the Play button&apos;s link, and signs this PC out.</p>
          <p>It keeps your screenshots (moved to Pictures\{m.name} screenshots), Java, the Minecraft Launcher and your other profiles, and your account here: your things on the server are safe. To play again later, download it above.</p>
        </CardContent>
      </Card>
    </div>
  );
}

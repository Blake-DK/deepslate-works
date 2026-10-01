import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { getManifest } from "@/server/modpack/manifest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { canSeeServer, getSettings } from "@/server/settings";
import { launchText } from "@/components/launch-banner";
import { db } from "@/server/db";
import { getStatus } from "@/server/status";
import { averagePing } from "@/server/ping";
import { pingTone } from "@/lib/ping";
import { tpsTone } from "@/lib/series";
import { getPlayInfo } from "@/server/play";
import { joinLine } from "@/lib/play";
import { clock } from "@/lib/utils";
import { getInstaller } from "@/server/modpack/lock";
import { mustDownloadAgain } from "@/lib/installer-version";
import { Alert } from "@/components/ui/alert";
import { VisualsForm } from "./visuals-form";
import { saveVisuals } from "./actions";

export const metadata: Metadata = { title: "Me" };

const TIER = { LOW: "older laptop / no graphics card", MID: "normal desktop or gaming laptop", HIGH: "proper gaming PC" } as const;

export default async function MePage() {
  const user = await requireOnboardedUser();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [status, week] = await Promise.all([getStatus(), user.mcUuid ? averagePing(user.mcUuid, weekAgo, new Date()) : Promise.resolve(null)]);
  const me = status.server === "online" ? (status.online.find((p) => (user.mcUuid && p.uuid === user.mcUuid) || (user.mcUsername && p.name.toLowerCase() === user.mcUsername.toLowerCase())) ?? null) : null;
  const [m, settings, install, installer, linkRun] = await Promise.all([
    getManifest(),
    getSettings(),
    // their own last install report: the outcome and the date, nothing else
    db.installReport.findFirst({ where: { userId: user.id }, orderBy: { at: "desc" }, select: { at: true, outcome: true, packVersion: true, failedStep: true, installerVersion: true, mode: true } }),
    getInstaller(),
    // installer 1.5.6: the latest report that says whether the Play button has a working link on their PC
    db.installReport.findFirst({ where: { userId: user.id, playLinkMissing: { not: null } }, orderBy: { at: "desc" }, select: { playLinkMissing: true } }),
  ]);
  // Their last run came from an older installer than the site hands out: until a report from a new one arrives.
  const oldInstaller = install && install.mode !== "uninstall" && installer && mustDownloadAgain(install.installerVersion, installer.version) ? installer.version : null;
  const showServer = canSeeServer(user, settings);
  const play = showServer ? await getPlayInfo(user) : null;
  const join = play ? joinLine(play.join ? (play.join.ok ? { ok: true, time: clock(play.join.until) } : play.join) : null, !play.tooOld) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{user.displayName}</h1>
        {user.mcUuid && <Link href={`/players/${user.mcUuid}`} className={buttonClasses("secondary", "sm")}>My player page</Link>}
      </div>
      {install && (
        <p className="text-sm text-muted-foreground" data-testid="last-install">
          {install.mode === "uninstall" && install.outcome === "ok"
            ? <>Deepslate Works was taken off your PC on {formatDate(install.at)}. To play again, <Link href="/help" className="underline">download it from Help → Getting in</Link>.</>
            : install.outcome === "ok"
            ? <>Installed {install.packVersion.split("+")[0]} on {formatDate(install.at)}, all good.</>
            : install.outcome === "cancelled"
              ? <>The installer was stopped on {formatDate(install.at)}{install.failedStep ? <> at &quot;{install.failedStep}&quot;</> : null}. Press Play again when you are ready.</>
              : <>The installer ran into trouble on {formatDate(install.at)}{install.failedStep ? <> at &quot;{install.failedStep}&quot;</> : null}. Alex has the log; press Play again, or ask him.</>}
        </p>
      )}
      {linkRun?.playLinkMissing && install?.mode !== "uninstall" && (
        <Alert tone="info" data-testid="play-link-missing">
          The Play button isn&apos;t set up on your PC yet. Run Setup.bat again from the extracted download; if it still fails, tell Alex.
        </Alert>
      )}
      {oldInstaller && (
        <Alert tone="info" data-testid="installer-outdated">
          <strong>Download Deepslate Works again.</strong> Your last run used {install!.installerVersion === "unknown" ? "an old installer" : <>installer {install!.installerVersion}</>}, which cannot update itself; the current one is {oldInstaller}.{" "}
          <Link href="/help" className="font-medium underline">Download it from Help → Getting in</Link> and double-click Setup.bat once. After that it keeps itself up to date.
        </Alert>
      )}
      {join && (
        <p className="text-sm" data-testid="join-window">
          <span className={join.ready ? "font-medium text-accent" : "font-medium"}>{join.text}</span>{" "}
          <Link href="/" className="underline">{join.ready ? "Home" : "The Play button is on Home"}</Link>
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Minecraft account {user.mcUsername ? <Badge tone="good">linked</Badge> : <Badge>not linked yet</Badge>}</CardTitle>
          <CardDescription>
            {user.mcUsername ? (
              <>Linked: <span className="font-mono text-foreground">{user.mcUsername}</span>{user.verifiedAt ? ` since ${formatDate(user.verifiedAt)}` : ""}.</>
            ) : (
              showServer ? (
                <>Join the server to link your Minecraft account. Connect to <span className="font-mono text-foreground">{m.server_address}</span>, you&apos;ll land in a small room with a link in the chat; click it and you&apos;re through. On a phone, or if the link has scrolled away: <Link href="/join" className="underline">enter the code</Link> shown on your screen.</>
              ) : (
                <>Join the server to link your Minecraft account: you&apos;ll land in a small room with a link in the chat, click it and you&apos;re through. {launchText(settings.launchAt)}</>
              )
            )}
          </CardDescription>
        </CardHeader>
        {!user.mcUsername && (
          <CardContent><Link href="/help" className={buttonClasses("primary", "sm")}>Get the game set up first</Link></CardContent>
        )}
      </Card>
      {(me || week) && (
        <Card data-testid="my-connection">
          <CardHeader>
            <CardTitle>Your connection</CardTitle>
            <CardDescription>
              {me ? (
                <>
                  {me.ping !== null ? <Badge tone={pingTone(me.ping)}>{me.ping} ms</Badge> : "You are on; your ping has not been measured yet"}
                  {status?.tps != null && <>, server speed <Badge tone={tpsTone(status.tps)}>{status.tps.toFixed(1)} TPS</Badge></>}.{" "}
                </>
              ) : "You are not on the server right now. "}
              {week ? <>Your average over the last 7 days: <strong className="text-foreground">{week.ms} ms</strong>.</> : "No average yet: it needs a few minutes on the server."}
              {" "}Press Tab in the game for the same numbers.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>My PC</CardTitle>
          <CardDescription>
            {user.pcTier ? TIER[user.pcTier] : "not set"}. Recommended render distance: {user.pcTier === "HIGH" ? 12 : user.pcTier === "MID" ? 10 : 8}.{" "}
            {user.pcTierSource === "measured"
              ? <>Measured by the installer{user.pcTierWhy ? <> ({user.pcTierWhy})</> : null}{user.pcTierAt ? <> on {formatDate(user.pcTierAt)}</> : null}. It is checked again each time you run it.</>
              : <>This is what you picked. The installer measures your PC and sets it for you. <Link href="/onboarding" className="underline">Change</Link>.</>}
          </CardDescription>
        </CardHeader>
      </Card>
      <Card data-testid="visuals">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Making it look nicer {user.visualExtras && <Badge tone="good">on</Badge>}</CardTitle>
          <CardDescription>
            Optional, only on your PC. Nobody else has to have them, and you can play together either way. Switch them off again any time; the next Play takes them out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user.pcTier === "LOW" && (
            <Alert tone="info" data-testid="visuals-weak-pc">
              The installer measured your PC as an older laptop or one without a graphics card. Visual extras will likely make the game stutter; if you try them, leave shaders on None or Light.
            </Alert>
          )}
          <VisualsForm action={saveVisuals} extras={user.visualExtras} shader={(["none", "light", "full"] as const).find((s) => s === user.shaders) ?? "none"} />
        </CardContent>
      </Card>
    </div>
  );
}

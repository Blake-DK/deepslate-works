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

export const metadata: Metadata = { title: "Me" };

const TIER = { LOW: "older laptop / no graphics card", MID: "normal desktop or gaming laptop", HIGH: "proper gaming PC" } as const;

export default async function MePage() {
  const user = await requireOnboardedUser();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [status, week] = await Promise.all([getStatus(), user.mcUuid ? averagePing(user.mcUuid, weekAgo, new Date()) : Promise.resolve(null)]);
  const me = status?.availability === "online" ? (status.online.find((p) => (user.mcUuid && p.uuid === user.mcUuid) || (user.mcUsername && p.name.toLowerCase() === user.mcUsername.toLowerCase())) ?? null) : null;
  const [m, settings, install] = await Promise.all([
    getManifest(),
    getSettings(),
    // their own last install report: the outcome and the date, nothing else
    db.installReport.findFirst({ where: { userId: user.id }, orderBy: { at: "desc" }, select: { at: true, outcome: true, packVersion: true, failedStep: true } }),
  ]);
  const showServer = canSeeServer(user, settings);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{user.displayName}</h1>
      {install && (
        <p className="text-sm text-muted-foreground" data-testid="last-install">
          {install.outcome === "ok"
            ? <>Installed {install.packVersion.split("+")[0]} on {formatDate(install.at)}, all good.</>
            : install.outcome === "cancelled"
              ? <>The installer was stopped on {formatDate(install.at)}{install.failedStep ? <> at &quot;{install.failedStep}&quot;</> : null}. Run it again when you are ready.</>
              : <>The installer ran into trouble on {formatDate(install.at)}{install.failedStep ? <> at &quot;{install.failedStep}&quot;</> : null}. Alex has the log; run it again, or ask him.</>}
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
                <>Join the server to link your Minecraft account. Connect to <span className="font-mono text-foreground">{m.server_address}</span>, you&apos;ll land in a small room with a link in the chat; click it and you&apos;re through. Nothing to type.</>
              ) : (
                <>Join the server to link your Minecraft account: you&apos;ll land in a small room with a link in the chat, click it and you&apos;re through. {launchText(settings.launchAt)}</>
              )
            )}
          </CardDescription>
        </CardHeader>
        {!user.mcUsername && (
          <CardContent><Link href="/install" className={buttonClasses("primary", "sm")}>Get the game set up first</Link></CardContent>
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
      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
          <CardDescription>Take me home, take me to spawn, where am I, and the rest arrive in phase 4.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

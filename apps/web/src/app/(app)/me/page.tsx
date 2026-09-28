import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { getManifest } from "@/server/modpack/manifest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Me" };

const TIER = { LOW: "older laptop / no graphics card", MID: "normal desktop or gaming laptop", HIGH: "proper gaming PC" } as const;

export default async function MePage() {
  const user = await requireOnboardedUser();
  const m = await getManifest();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{user.displayName}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Minecraft account {user.mcUsername ? <Badge tone="good">linked</Badge> : <Badge>not linked yet</Badge>}</CardTitle>
          <CardDescription>
            {user.mcUsername ? (
              <>Linked: <span className="font-mono text-foreground">{user.mcUsername}</span>{user.verifiedAt ? ` since ${formatDate(user.verifiedAt)}` : ""}.</>
            ) : (
              <>Join the server to link your Minecraft account. Connect to <span className="font-mono text-foreground">{m.server_address}</span>, you&apos;ll land in a small room with a link in the chat; click it and you&apos;re through. Nothing to type.</>
            )}
          </CardDescription>
        </CardHeader>
        {!user.mcUsername && (
          <CardContent><Link href="/install" className={buttonClasses("primary", "sm")}>Get the game set up first</Link></CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>My PC</CardTitle>
          <CardDescription>{user.pcTier ? TIER[user.pcTier] : "not set"}. Recommended render distance: {user.pcTier === "HIGH" ? 12 : user.pcTier === "MID" ? 10 : 8}. <Link href="/onboarding" className="underline">Change</Link>.</CardDescription>
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

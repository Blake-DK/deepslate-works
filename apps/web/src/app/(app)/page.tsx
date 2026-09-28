import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/env";
import { getOpenVote } from "@/server/vote/votes";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const [members, openVote] = await Promise.all([db.user.count(), getOpenVote()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user.displayName}</h1>
        <p className="text-muted-foreground">{user.mcUsername ? <>Linked to Minecraft account <span className="font-mono">{user.mcUsername}</span>.</> : <>Your Minecraft account gets linked the first time you join the server.</>} {members} {members === 1 ? "person" : "people"} in the group so far.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Server <Badge>Not set up yet</Badge></CardTitle>
            <CardDescription>Live status, who&apos;s online and the map arrive in phase 3. Address: <span className="font-mono">{env.SERVER_ADDRESS}</span></CardDescription>
          </CardHeader>
        </Card>
        <Card className={openVote ? "border-primary" : undefined}>
          <CardHeader>
            <CardTitle>{openVote ? `Vote open: ${openVote.title}` : "The mod list"}</CardTitle>
            <CardDescription>{openVote ? `Tick the mods you want${openVote.closesAt ? ` before ${formatDate(openVote.closesAt)}` : ""}. Takes two minutes on a phone.` : "Read up on every mod, with videos and wiki links. The season vote will show up here when it opens."}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            {openVote && <Link href="/vote" className={buttonClasses("primary", "sm")}>Vote now</Link>}
            <Link href="/mods" className={buttonClasses("secondary", "sm")}>Mod list</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

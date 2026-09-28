import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { env } from "@/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const members = await db.user.count();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user.displayName}</h1>
        <p className="text-muted-foreground">Playing as <span className="font-mono">{user.mcUsername}</span>. {members} {members === 1 ? "person" : "people"} in the group so far.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Server <Badge>Not set up yet</Badge></CardTitle>
            <CardDescription>Live status, who&apos;s online and the map arrive in phase 3. Address: <span className="font-mono">{env.SERVER_ADDRESS}</span></CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s next</CardTitle>
            <CardDescription>The mod catalogue and the season vote are coming next. You&apos;ll get a nudge in Discord.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/mods" className={buttonClasses("secondary", "sm")}>Peek at the mod list</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

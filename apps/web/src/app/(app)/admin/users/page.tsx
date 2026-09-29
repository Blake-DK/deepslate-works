import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import Link from "next/link";
import { clearMinecraftNameAction, removeUserAction, revokeLauncherAction, setEarlyAccessAction, setMinecraftNameAction, setRoleAction } from "./actions";
import { getSettings } from "@/server/settings";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

const ERRORS: Record<string, string> = {
  name: "Minecraft names are 3 to 16 letters, numbers or underscores.",
  not_found: "Mojang has no Java Edition account with that name.",
  unavailable: "Couldn't reach Mojang. Try again in a minute.",
  taken: "That Minecraft account is already linked to another member.",
};

export const metadata: Metadata = { title: "Players" };

const SHOW = { all: "Everyone", early: "Early access", rest: "Without" } as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string }> }) {
  const me = await requireAdmin();
  const { error, show } = await searchParams;
  const only = show === "early" || show === "rest" ? show : "all";
  const [all, settings] = await Promise.all([db.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] }), getSettings()]);
  const users = all.filter((u) => only === "all" || (only === "early" ? u.earlyAccess : !u.earlyAccess));
  const count = { all: all.length, early: all.filter((u) => u.earlyAccess).length, rest: all.filter((u) => !u.earlyAccess).length };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Players</h1>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <p className="text-sm text-muted-foreground">Minecraft accounts link themselves in game (docs/14). The name box below is the admin fallback: it checks the name with Mojang and links it by hand.</p>
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Filter by early access">
          {(Object.keys(SHOW) as Array<keyof typeof SHOW>).map((k) => <Link key={k} href={k === "all" ? "/admin/users" : `/admin/users?show=${k}`} aria-current={only === k ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${only === k ? "bg-card font-medium shadow-sm" : "hover:bg-card"}`}>{SHOW[k]} ({count[k]})</Link>)}
        </nav>
        <p className="text-sm text-muted-foreground">Early access: while &quot;We&apos;re live&quot; is off, the member can download, press Play and join like any player once it is on. Nothing of an admin&apos;s. {settings.live ? "The site is live, so the flag changes nothing right now." : "The site is not live."}</p>
      </div>
      <Card>
        <CardContent className="pt-5">
          {users.length === 0 && <p className="pb-4 text-sm text-muted-foreground">Nobody.</p>}
          <ul className="divide-y">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                <span className="font-medium">{u.displayName}</span>
                <Badge tone={u.role === "ADMIN" ? "warn" : "neutral"}>{u.role.toLowerCase()}</Badge>
                {u.earlyAccess && <Badge tone="good" data-testid="early">early access</Badge>}
                {u.mcUsername ? (
                  <span className="flex items-center gap-2"><span className="font-mono">{u.mcUsername}</span>{u.verifiedAt && <Badge tone="good">verified</Badge>}
                    <form action={clearMinecraftNameAction}><input type="hidden" name="id" value={u.id} /><Button type="submit" variant="ghost" size="sm" title="Unlink the Minecraft account">Unlink</Button></form>
                  </span>
                ) : (
                  <form action={setMinecraftNameAction} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={u.id} />
                    <Input name="mcUsername" placeholder="Minecraft name" className="h-8 w-40 text-sm" pattern="[A-Za-z0-9_]{3,16}" required />
                    <Button type="submit" variant="secondary" size="sm">Link</Button>
                  </form>
                )}
                <span className="text-muted-foreground">{u.pcTier ? `${u.pcTier.toLowerCase()} PC` : "no tier"} · {u.discordId ? "Discord" : "email"}{u.discordId && !u.guildMember ? " · left the server" : ""} · seen {timeAgo(u.lastSeenAt)}</span>
                <form action={setEarlyAccessAction} className={u.id === me.id ? "ml-auto" : undefined}>
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="on" value={u.earlyAccess ? "0" : "1"} />
                  <Button type="submit" variant={u.earlyAccess ? "ghost" : "secondary"} size="sm" title={u.role === "ADMIN" ? "Admins can do all of it anyway; the flag counts if they are made a player" : undefined}>{u.earlyAccess ? "Take early access away" : "Early access"}</Button>
                </form>
                {u.id !== me.id && (
                  <span className="ml-auto flex gap-2">
                    <form action={setRoleAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="role" value={u.role === "ADMIN" ? "PLAYER" : "ADMIN"} />
                      <Button type="submit" variant="secondary" size="sm">{u.role === "ADMIN" ? "Make player" : "Make admin"}</Button>
                    </form>
                    <form action={revokeLauncherAction} title="Sign the installer out on all their PCs">
                      <input type="hidden" name="id" value={u.id} />
                      <Button type="submit" variant="ghost" size="sm">Sign out installer</Button>
                    </form>
                    <form action={removeUserAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <Button type="submit" variant="ghost" size="sm">Remove</Button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

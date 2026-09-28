import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { clearMinecraftNameAction, removeUserAction, setMinecraftNameAction, setRoleAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

const ERRORS: Record<string, string> = {
  name: "Minecraft names are 3 to 16 letters, numbers or underscores.",
  not_found: "Mojang has no Java Edition account with that name.",
  unavailable: "Couldn't reach Mojang. Try again in a minute.",
  taken: "That Minecraft account is already linked to another member.",
};

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireAdmin();
  const { error } = await searchParams;
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      {error && <Alert tone="error">{ERRORS[error] ?? "Something went wrong."}</Alert>}
      <p className="text-sm text-muted-foreground">Minecraft accounts link themselves in game (docs/14). The name box below is the admin fallback: it checks the name with Mojang and links it by hand.</p>
      <Card>
        <CardContent className="pt-5">
          <ul className="divide-y">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                <span className="font-medium">{u.displayName}</span>
                <Badge tone={u.role === "ADMIN" ? "warn" : "neutral"}>{u.role.toLowerCase()}</Badge>
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
                {u.id !== me.id && (
                  <span className="ml-auto flex gap-2">
                    <form action={setRoleAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="role" value={u.role === "ADMIN" ? "PLAYER" : "ADMIN"} />
                      <Button type="submit" variant="secondary" size="sm">{u.role === "ADMIN" ? "Make player" : "Make admin"}</Button>
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

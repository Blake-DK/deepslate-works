import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { removeUserAction, setRoleAction } from "./actions";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Card>
        <CardContent className="pt-5">
          <ul className="divide-y">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                <span className="font-medium">{u.displayName}</span>
                <Badge tone={u.role === "ADMIN" ? "warn" : "neutral"}>{u.role.toLowerCase()}</Badge>
                <span className="font-mono">{u.mcUsername ?? <span className="text-muted-foreground">not set up</span>}</span>
                <span className="text-muted-foreground">{u.pcTier ? `${u.pcTier.toLowerCase()} PC` : "no tier"} · {u.discordId ? "Discord" : "email"} · seen {timeAgo(u.lastSeenAt)}</span>
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

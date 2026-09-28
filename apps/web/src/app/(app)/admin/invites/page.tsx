import type { Metadata } from "next";
import { db } from "@/server/db";
import { env } from "@/env";
import { inviteState } from "@/server/auth/invite-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { createInviteAction, revokeInviteAction } from "./actions";
import { CopyButton } from "./copy-button";

export const metadata: Metadata = { title: "Invites" };

export default async function InvitesPage() {
  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const userIds = invites.map((i) => i.usedBy).filter((x): x is string => Boolean(x));
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.displayName]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invites</h1>
      <Card>
        <CardHeader>
          <CardTitle>New invite</CardTitle>
          <CardDescription>Send the link in Discord. One link, one person.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createInviteAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="note">Who is it for?</Label>
              <Input id="note" name="note" placeholder="for Bertie" maxLength={60} />
            </div>
            <div className="w-28">
              <Label htmlFor="days">Valid for (days)</Label>
              <Input id="days" name="days" type="number" min={1} max={90} defaultValue={7} />
            </div>
            <Button type="submit">Create invite</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          {invites.length === 0 ? <p className="text-sm text-muted-foreground">No invites yet.</p> : (
            <ul className="divide-y">
              {invites.map((i) => {
                const state = inviteState(i);
                const link = `${env.AUTH_URL}/join/${i.code}`;
                return (
                  <li key={i.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                    <span className="font-mono text-base">{i.code}</span>
                    <Badge tone={state === "valid" ? "good" : state === "used" ? "neutral" : "bad"}>{state}</Badge>
                    <span className="text-muted-foreground">{i.note ?? "—"}</span>
                    <span className="text-muted-foreground">{state === "used" ? `used by ${nameOf.get(i.usedBy!) ?? "?"}` : `expires ${formatDate(i.expiresAt)}`}</span>
                    <span className="ml-auto flex gap-2">
                      {state === "valid" && <CopyButton text={link} />}
                      {state !== "used" && (
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="code" value={i.code} />
                          <Button type="submit" variant="ghost" size="sm">Remove</Button>
                        </form>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

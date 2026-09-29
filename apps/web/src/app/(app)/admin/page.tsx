import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { KIND_LABEL, type EventKind } from "@/shared/events";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHome() {
  const [users, openInvites, recent] = await Promise.all([
    db.user.count(),
    db.invite.count({ where: { usedBy: null, expiresAt: { gt: new Date() } } }),
    db.event.findMany({ where: { kind: { in: ["ADMIN_ACTION", "PLAYER_ACTION", "LINK", "REVOKE", "SYNC", "BACKUP"] } }, orderBy: { at: "desc" }, take: 10, select: { id: true, at: true, kind: true, message: true, meta: true } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle>{users}</CardTitle><CardDescription><Link href="/admin/users" className="underline">members</Link></CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>{openInvites}</CardTitle><CardDescription><Link href="/admin/invites" className="underline">open invites</Link></CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Phase 3</CardTitle><CardDescription><Link href="/admin/votes" className="underline">Votes</Link>, the <Link href="/admin/modpack" className="underline">modpack</Link> and <Link href="/admin/server" className="underline">server control</Link> are live. Player self-service arrives in phase 4.</CardDescription></CardHeader></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>The last 10 things people did on the site. Everything is in the <Link href="/admin/events" className="underline">event log</Link>.</CardDescription></CardHeader>
        <CardContent>
          {recent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
            <ul className="divide-y text-sm">
              {recent.map((r) => {
                const meta = (r.meta ?? {}) as { result?: string; detail?: string | null };
                return (
                  <li key={String(r.id)} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    <span className="text-muted-foreground">{formatDate(r.at)}</span>
                    <Badge>{KIND_LABEL[r.kind as EventKind]}</Badge>
                    <span className={meta.result && meta.result !== "OK" ? "text-danger" : undefined}>{r.message}</span>
                    {meta.detail && <span className="text-muted-foreground">{meta.detail}</span>}
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

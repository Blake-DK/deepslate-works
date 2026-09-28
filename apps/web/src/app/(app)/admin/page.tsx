import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHome() {
  const [users, openInvites, recent] = await Promise.all([
    db.user.count(),
    db.invite.count({ where: { usedBy: null, expiresAt: { gt: new Date() } } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { displayName: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle>{users}</CardTitle><CardDescription><Link href="/admin/users" className="underline">members</Link></CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>{openInvites}</CardTitle><CardDescription><Link href="/admin/invites" className="underline">open invites</Link></CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Phase 0</CardTitle><CardDescription>Votes, modpack, server and actions arrive in later phases.</CardDescription></CardHeader></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Last 10 audit entries.</CardDescription></CardHeader>
        <CardContent>
          {recent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
            <ul className="divide-y text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-x-3 py-2">
                  <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>
                  <span className="font-mono">{r.action}</span>
                  <span>{r.user?.displayName ?? "—"}</span>
                  <span className={r.result === "OK" ? "text-accent" : "text-danger"}>{r.result}</span>
                  {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { db } from "@/server/db";
import { timeAgo } from "@/lib/utils";

/** Admin password and break-glass sign-ins of the last 24 hours, shown to every admin (planner, 2026-10-01). */
export const NOTICE_ACTIONS = ["auth.adminPassword", "auth.adminLink"] as const;
export const NOTICE_HOURS = 24;

export async function AdminSignInNotice() {
  const since = new Date(Date.now() - NOTICE_HOURS * 3600_000);
  const rows = await db.event.findMany({
    where: { kind: "ADMIN_ACTION", at: { gte: since }, OR: NOTICE_ACTIONS.map((a) => ({ meta: { path: ["action"], equals: a } })) },
    orderBy: { at: "desc" },
    take: 5,
    select: { id: true, at: true, message: true },
  });
  if (rows.length === 0) return null;
  return (
    <Alert tone="info" data-testid="admin-signin-notice" className="mb-4">
      <p className="font-medium">Password sign-in{rows.length > 1 ? "s" : ""} in the last {NOTICE_HOURS} hours</p>
      <ul className="mt-1 list-disc pl-5">{rows.map((r) => <li key={String(r.id)}>{r.message}, {timeAgo(r.at)}</li>)}</ul>
      <p className="mt-1">Not you, or not who you expected? Turn their password sign-in off in <Link href="/admin/people" className="underline">People</Link> and tell them.</p>
    </Alert>
  );
}

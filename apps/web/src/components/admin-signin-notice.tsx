import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { signInNotice } from "@/server/auth/signin-notice";
import { NOTICE_HOURS } from "@/server/auth/signin-notice-core";
import { seenSignInNoticeAction } from "@/server/auth/signin-notice-actions";

/**
 * Admin password and break-glass sign-ins of the last 24 hours, shown to every admin (planner, 2026-10-01), until that
 * admin says they have seen them (Alex, 2026-10-07; src/server/auth/signin-notice-core.ts). One click each time.
 */
export async function AdminSignInNotice({ viewerId }: { viewerId: string }) {
  const { rows, label, newest } = await signInNotice(viewerId);
  if (newest === null) return null;
  return (
    <Alert tone="info" data-testid="admin-signin-notice" className="mb-4">
      <p className="font-medium">Password sign-in{rows.length > 1 ? "s" : ""} in the last {NOTICE_HOURS} hours</p>
      <ul className="mt-1 list-disc pl-5">{rows.map((r) => <li key={String(r.id)}>{r.message}, {timeAgo(r.at)}</li>)}</ul>
      <p className="mt-1">Not you, or not who you expected? Turn their password sign-in off in <Link href="/admin/people" className="underline">People</Link> and tell them.</p>
      <form action={seenSignInNoticeAction} className="mt-2">
        <input type="hidden" name="shown" value={String(newest)} />
        <button type="submit" className={buttonClasses("secondary", "sm")} data-testid="admin-signin-notice-seen">{label}</button>
      </form>
    </Alert>
  );
}

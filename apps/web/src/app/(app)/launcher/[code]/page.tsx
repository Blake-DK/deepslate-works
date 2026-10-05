import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { normaliseInviteCode } from "@/server/auth/invite-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingButton } from "@/components/admin/pending-button";
import { getInstaller } from "@/server/modpack/lock";
import { Alert } from "@/components/ui/alert";
import { decideLauncherAction } from "./actions";

export const metadata: Metadata = { title: "Approve installer" };

export default async function LauncherApprovePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ done?: string }> }) {
  const user = await requireOnboardedUser();
  const { code: raw } = await params;
  const { done } = await searchParams;
  const code = normaliseInviteCode(raw);
  const row = code ? await db.launcherAuth.findUnique({ where: { code } }) : null;
  const live = row && row.status === "pending" && row.expiresAt.getTime() > Date.now();
  // 3.0: the download is DeepslateWorks.exe and the code is in its own window (as /install knows it)
  const exe = (await getInstaller())?.download === "DeepslateWorks.exe";

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Installer sign-in</h1>
      {done === "ok" && <Alert tone="success">Approved. You can close this tab and go back to the installer window; it carries on by itself.</Alert>}
      {done === "denied" && <Alert tone="info">Denied. The installer will stop. If that wasn&apos;t you, tell Alex.</Alert>}
      {done === "gone" && <Alert tone="error">That code has expired or was already used. Press Play again for a fresh one.</Alert>}
      {!done && (
        <Card>
          <CardHeader>
            <CardTitle>Code <span className="font-mono text-primary">{code || "?"}</span></CardTitle>
            <CardDescription>
              {live ? (
                <>The Deepslate Works installer{row.hostname ? <> on <span className="font-mono">{row.hostname}</span></> : null} is asking to update the game as <strong>{user.displayName}</strong>. Only approve if this code matches the one in the {exe ? "Deepslate Works window" : "black installer window"}.</>
              ) : (
                <>This code isn&apos;t waiting for approval. It may have expired (codes last 10 minutes). Press Play again.</>
              )}
            </CardDescription>
          </CardHeader>
          {live && (
            <CardContent>
              <form action={decideLauncherAction.bind(null, "deny")} className="flex gap-2">
                <input type="hidden" name="code" value={code} />
                {/* docs/35 R-28: busy while it is sent, so a second click cannot land on a code that is already used */}
                <PendingButton formAction={decideLauncherAction.bind(null, "approve")} variant="primary" size="lg" busy="One moment…">Yes, that&apos;s me</PendingButton>
                <PendingButton formAction={decideLauncherAction.bind(null, "deny")} size="lg" busy="One moment…">No</PendingButton>
              </form>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { normaliseInviteCode } from "@/server/auth/invite-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-semibold">Installer sign-in</h1>
      {done === "ok" && <Alert tone="success">Approved. You can close this tab and go back to the installer window; it carries on by itself.</Alert>}
      {done === "denied" && <Alert tone="info">Denied. The installer will stop. If that wasn&apos;t you, tell Alex.</Alert>}
      {done === "gone" && <Alert tone="error">That code has expired or was already used. Run the installer again for a fresh one.</Alert>}
      {!done && (
        <Card>
          <CardHeader>
            <CardTitle>Code <span className="font-mono text-primary">{code || "?"}</span></CardTitle>
            <CardDescription>
              {live ? (
                <>The Deepslate Works installer{row.hostname ? <> on <span className="font-mono">{row.hostname}</span></> : null} is asking to update the game as <strong>{user.displayName}</strong>. Only approve if this code matches the one in the black installer window.</>
              ) : (
                <>This code isn&apos;t waiting for approval. It may have expired (codes last 10 minutes). Run the installer again.</>
              )}
            </CardDescription>
          </CardHeader>
          {live && (
            <CardContent>
              <form action={decideLauncherAction} className="flex gap-2">
                <input type="hidden" name="code" value={code} />
                <Button type="submit" name="decision" value="approve" size="lg">Yes, that&apos;s me</Button>
                <Button type="submit" name="decision" value="deny" variant="secondary" size="lg">No</Button>
              </form>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

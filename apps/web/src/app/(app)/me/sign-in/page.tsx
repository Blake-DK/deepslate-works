import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { openSecret, recoveryOf } from "@/server/auth/admin-login";
import { otpauthUrl } from "@/server/auth/totp";
import { MIN_PASSWORD } from "@/server/auth/password-policy";
import { env } from "@/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { StateForm } from "./forms";
import { cancelSetup, cancelTotpReset, changePassword, confirmSetup, confirmTotpReset, regenerateRecovery, startSetup, startTotpReset, turnOffOwn } from "./actions";

export const metadata: Metadata = { title: "Password sign-in" };

const CODE = { name: "code", label: "Code from your authenticator app", type: "code" as const };

async function Enrol({ secret, username, confirm, cancel }: { secret: string; username: string; confirm: typeof confirmSetup; cancel: () => Promise<void> }) {
  const qr = await QRCode.toDataURL(otpauthUrl(secret, username, env.SITE_NAME), { margin: 1, width: 220 });
  return (
    <div className="space-y-3">
      <p className="text-sm">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Aegis…), then type the 6-digit code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: address made on the server */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg border bg-white p-2" data-testid="totp-qr" />
      <p className="text-sm">Can&apos;t scan it? Enter this key by hand (time-based, 6 digits):</p>
      <p className="break-all rounded bg-muted px-2 py-1 font-mono text-sm" data-testid="totp-key">{secret.match(/.{1,4}/g)?.join(" ")}</p>
      <StateForm action={confirm} fields={[CODE]} submit="Confirm" testId="totp-confirm" />
      <form action={cancel}><Button type="submit" variant="ghost" size="sm">Start again</Button></form>
    </div>
  );
}

export default async function SignInSettingsPage() {
  const me = await requireAdmin();
  const row = await db.adminLogin.findUnique({ where: { userId: me.id } });
  const pending = openSecret(row?.pendingSecret ?? null);
  const left = row ? recoveryOf(row.recovery).filter((r) => !r.usedAt).length : 0;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Password sign-in</h1>
        <p className="text-sm text-muted-foreground">
          For admins, for the day Discord is down or your Discord account is gone. Username, password and a code from an authenticator app, all three every time. A session from it lasts 12 hours. Every sign-in this way shows on every admin&apos;s Home.
        </p>
      </div>
      {!row?.enabled && !pending && (
        <Card>
          <CardHeader>
            <CardTitle>Set up password sign-in</CardTitle>
            <CardDescription>{row ? "Your authenticator was switched off (a reset from the command line). Set it all up again." : "Step 1 of 2: a username and a password only for this."}</CardDescription>
          </CardHeader>
          <CardContent>
            <StateForm
              action={startSetup}
              testId="setup"
              submit="Next"
              fields={[
                { name: "username", label: "Username", autoComplete: "username", defaultValue: row?.username, hint: "3 to 32 characters: lower-case letters, digits, dot, dash, underscore." },
                { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: `At least ${MIN_PASSWORD} characters, not a common one. A password manager's is best.` },
                { name: "confirm", label: "Password again", type: "password", autoComplete: "new-password" },
              ]}
            />
          </CardContent>
        </Card>
      )}
      {row && !row.enabled && pending && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2 of 2: your authenticator app</CardTitle>
            <CardDescription>Password sign-in is switched on only once a code from the app has been confirmed.</CardDescription>
          </CardHeader>
          <CardContent><Enrol secret={pending} username={row.username} confirm={confirmSetup} cancel={cancelSetup} /></CardContent>
        </Card>
      )}
      {row?.enabled && (
        <>
          <Card data-testid="signin-on">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">On <Badge tone="good">password + code</Badge></CardTitle>
              <CardDescription>
                Username <span className="font-mono text-foreground">{row.username}</span>, since {formatDate(row.enabledAt ?? row.createdAt)}. Password last set {formatDate(row.passwordAt)}. {left} of 10 recovery codes left.{" "}
                Sign in at <Link href="/login/admin" className="underline">Admin sign-in</Link> (a small link under the Discord button).
              </CardDescription>
            </CardHeader>
          </Card>
          {pending ? (
            <Card>
              <CardHeader><CardTitle>New authenticator app</CardTitle></CardHeader>
              <CardContent><Enrol secret={pending} username={row.username} confirm={confirmTotpReset} cancel={cancelTotpReset} /></CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>Change password</CardTitle><CardDescription>Sessions that signed in with the old password end.</CardDescription></CardHeader>
              <CardContent>
                <StateForm action={changePassword} testId="change-password" submit="Change password" fields={[
                  { name: "current", label: "Current password", type: "password", autoComplete: "current-password" },
                  { name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: `At least ${MIN_PASSWORD} characters, not a common one.` },
                  { name: "confirm", label: "New password again", type: "password", autoComplete: "new-password" },
                  CODE,
                ]} />
              </CardContent>
            </Card>
          )}
          {!pending && (
            <Card>
              <CardHeader><CardTitle>New phone or authenticator app</CardTitle><CardDescription>Needs a code from the current one. Until you confirm the new one, the old one keeps working.</CardDescription></CardHeader>
              <CardContent><StateForm action={startTotpReset} testId="totp-reset" submit="Set up a new one" fields={[CODE]} /></CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Recovery codes</CardTitle><CardDescription>{left} left. Making new ones throws the old ones away.</CardDescription></CardHeader>
            <CardContent><StateForm action={regenerateRecovery} testId="recovery" submit="Make 10 new codes" fields={[CODE]} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Turn password sign-in off</CardTitle><CardDescription>Discord sign-in is not affected. Sessions that came in by password end.</CardDescription></CardHeader>
            <CardContent><StateForm action={turnOffOwn} testId="turn-off" submit="Turn it off" danger fields={[CODE]} /></CardContent>
          </Card>
        </>
      )}
      <Link href="/me" className={buttonClasses("secondary", "sm")}>Back to Me</Link>
    </div>
  );
}

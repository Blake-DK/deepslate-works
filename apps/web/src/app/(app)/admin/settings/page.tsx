import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { getManifest } from "@/server/modpack/manifest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { launchText } from "@/components/launch-banner";
import { saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  // Show the stored instant as UK wall-clock time in the datetime-local box.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [{ saved, error }, settings, manifest] = await Promise.all([searchParams, getSettings(), getManifest()]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {saved && <Alert tone="success">Saved.</Alert>}
      {error && <Alert tone="error">Check the launch date and try again.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Launch {settings.live ? <Badge tone="good">live</Badge> : <Badge tone="warn">not live</Badge>}</CardTitle>
          <CardDescription>
            Until you flip this, players never see the server address (<span className="font-mono">{manifest.server_address}</span>) or the installer and pack downloads; the Install and Home pages show the launch date instead. Once live, downloads open whenever the server is running. Admins always see everything.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSettingsAction} className="space-y-4">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
              <input type="checkbox" name="live" defaultChecked={settings.live} className="h-5 w-5 accent-[var(--primary)]" />
              <span><span className="block font-medium">We&apos;re live</span><span className="block text-sm text-muted-foreground">Unlocks the address and downloads for players.</span></span>
            </label>
            <div className="max-w-xs">
              <Label htmlFor="launchAt">Launch date (UK time, optional)</Label>
              <Input id="launchAt" name="launchAt" type="datetime-local" defaultValue={toLocalInput(settings.launchAt)} />
              <p className="mt-1 text-xs text-muted-foreground">Players see: &quot;{launchText(settings.launchAt)}&quot;. Leave empty for &quot;to be announced&quot;.</p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

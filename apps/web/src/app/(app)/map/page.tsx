import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/env";
import { getStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage() {
  const status = await getStatus();
  const up = Boolean(env.MAP_URL) && status.server === "online";
  if (!up) {
    const a = statusText(status, false);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Map</CardTitle>
          <CardDescription>{env.MAP_URL ? <>The map comes from the game server, so it is only there while the server is running. Right now: {a.line}. {a.hint}</> : "The map isn't set up yet."}</CardDescription>
        </CardHeader>
        <CardContent><Link href="/" className={buttonClasses("secondary", "sm")}>Back</Link></CardContent>
      </Card>
    );
  }
  return (
    // Full bleed: covers the page chrome. The back button stays on top of the map.
    <div className="fixed inset-0 z-40 bg-background">
      <iframe src={env.MAP_URL} title="Live map of the world" className="h-full w-full border-0" allow="fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
      <Link href="/" className={`${buttonClasses("secondary", "sm")} fixed bottom-4 left-4 z-50 shadow-lg`}>← Back</Link>
      <a href={env.MAP_URL} target="_blank" rel="noreferrer" className={`${buttonClasses("secondary", "sm")} fixed bottom-4 left-28 z-50 shadow-lg`}>Open in a new tab</a>
    </div>
  );
}

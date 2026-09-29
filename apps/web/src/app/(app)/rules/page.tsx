import type { Metadata } from "next";
import { getBranding } from "@/server/branding";
import { getSection } from "@/server/site-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  const [b, privacy, retention] = await Promise.all([getBranding(), getSection("privacy"), getSection("retention")]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Rules</h1>
      <Card>
        <CardContent className="p-5">{b.rules.trim() ? <Markdown text={b.rules} /> : <p className="text-muted-foreground">No rules have been written down yet. Be decent to each other.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What the site keeps</CardTitle>
          <CardDescription>So nobody is surprised.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            <li>When you join and leave the server, your deaths and your advancements. Everyone in the group can see these.</li>
            <li>{privacy.chat ? <>What is said in the in-game chat, for {retention.chatDays} days. Only admins can read it back.</> : "In-game chat is not stored."}</li>
            <li>The address you connect from, for {retention.ipDays} days. Only admins can see it.{privacy.geo ? " The country it belongs to is shown on the stats page." : ""}</li>
            <li>What you do on this site (voting, linking your account), for {retention.eventDays} days.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

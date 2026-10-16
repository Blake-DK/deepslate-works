import Link from "next/link";
import { getBranding } from "@/server/branding";
import { getSection } from "@/server/site-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { DataKept } from "@/components/data-kept";

export default async function RulesPage() {
  const [b, privacy, retention] = await Promise.all([getBranding(), getSection("privacy"), getSection("retention")]);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Rules</h2>
      <Card>
        <CardContent className="p-5">{b.rules.trim() ? <Markdown text={b.rules} /> : <p className="text-muted-foreground">No rules have been written down yet. Be decent to each other.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What the site keeps</CardTitle>
          <CardDescription>So nobody is surprised.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataKept privacy={privacy} retention={retention} />
          <p className="mt-3 text-sm text-muted-foreground">More on the <Link href="/privacy" className="underline">privacy page</Link>, and the <Link href="/terms" className="underline">terms</Link>.</p>
        </CardContent>
      </Card>
    </div>
  );
}

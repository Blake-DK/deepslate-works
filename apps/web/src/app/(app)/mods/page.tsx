import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Mods" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mods</CardTitle>
        <CardDescription>The mod catalogue with videos and wiki links. Coming in phase 1; nothing to see here yet.</CardDescription>
      </CardHeader>
    </Card>
  );
}

import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Install" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Install</CardTitle>
        <CardDescription>One-click installer and the Mac/Linux pack. Coming in phase 2; nothing to see here yet.</CardDescription>
      </CardHeader>
    </Card>
  );
}

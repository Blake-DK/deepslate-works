import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Players" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Players</CardTitle>
        <CardDescription>Who&apos;s in the group and who&apos;s online. Coming in phase 3; nothing to see here yet.</CardDescription>
      </CardHeader>
    </Card>
  );
}

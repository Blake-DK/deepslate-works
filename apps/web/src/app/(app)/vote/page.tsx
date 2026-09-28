import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Vote" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vote</CardTitle>
        <CardDescription>The season mod vote. Coming in phase 1; nothing to see here yet.</CardDescription>
      </CardHeader>
    </Card>
  );
}

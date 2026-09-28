import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Map" };

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Map</CardTitle>
        <CardDescription>Live 3D map of the world. Coming in phase 3; nothing to see here yet.</CardDescription>
      </CardHeader>
    </Card>
  );
}

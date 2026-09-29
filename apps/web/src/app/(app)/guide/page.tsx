import type { Metadata } from "next";
import { requireOnboardedUser } from "@/server/auth/session";
import { getGuide } from "@/server/guide";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

export const metadata: Metadata = { title: "Guide" };

// docs/18. Written in Admin -> Branding; the parts about mods that are not in the pack are left out.
export default async function GuidePage() {
  await requireOnboardedUser();
  const guide = await getGuide();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Guide</h1>
      <Card>
        <CardContent className="p-5"><Markdown text={guide} /></CardContent>
      </Card>
    </div>
  );
}

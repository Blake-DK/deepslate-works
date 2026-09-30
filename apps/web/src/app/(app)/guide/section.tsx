import { requireOnboardedUser } from "@/server/auth/session";
import { getGuide } from "@/server/guide";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

// docs/18. Written in Admin -> Branding; the parts about mods that are not in the pack are left out.
export default async function GuidePage() {
  await requireOnboardedUser();
  const guide = await getGuide();
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Guide</h2>
      <Card>
        <CardContent className="p-5"><Markdown text={guide} /></CardContent>
      </Card>
    </div>
  );
}

import { requireOnboardedUser } from "@/server/auth/session";
import { getGuide } from "@/server/guide";
import { getSeasonGuide } from "@/server/season";
import { Card, CardContent } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";

// docs/18. Written in Admin -> Branding; the parts about mods that are not in the pack are left out.
export default async function GuidePage() {
  await requireOnboardedUser();
  // docs/20 §7: once a season is announced, its section is added, written from the season's file
  const [text, season] = await Promise.all([getGuide(), getSeasonGuide().catch(() => null)]);
  const guide = season ? `${text.trimEnd()}\n\n${season}\n` : text;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Guide</h2>
      <Card>
        <CardContent className="p-5"><Markdown text={guide} /></CardContent>
      </Card>
    </div>
  );
}

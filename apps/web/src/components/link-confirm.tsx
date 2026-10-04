import { confirmLinkAction } from "@/server/link-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * docs/31 B-06: the question before a Minecraft account is linked. One button, a POST. It names both accounts,
 * so a link that somebody else sent is seen for what it is.
 */
export function LinkConfirm({ code, mcUsername, displayName, via }: { code: string; mcUsername: string; displayName: string; via: "link" | "join" }) {
  return (
    <Card data-testid="link-confirm">
      <CardHeader>
        <CardTitle>Link <span className="font-mono">{mcUsername}</span> to {displayName}?</CardTitle>
        <CardDescription>
          <span className="font-mono text-foreground">{mcUsername}</span> is the Minecraft account waiting in the entrance room with this code. Only say yes if that is you, in the game, right now. If somebody sent you this link, it is their account, not yours: close the page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={confirmLinkAction}>
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="via" value={via} />
          <Button type="submit" size="lg" className="w-full">Yes, that&apos;s me. Link it</Button>
        </form>
      </CardContent>
    </Card>
  );
}

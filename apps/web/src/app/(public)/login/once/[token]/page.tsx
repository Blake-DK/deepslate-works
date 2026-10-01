import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { oneTimeLogin } from "../../actions";

export const metadata: Metadata = { title: "One-time sign-in" };

// Break-glass (docs/09). The link is used only by pressing the button (a POST), so a link preview or a browser
// fetching the page ahead does not use it up.
export default async function OneTimePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      <Card>
        <CardHeader>
          <CardTitle>One-time sign-in</CardTitle>
          <CardDescription>This link was made from the command line on the server. It works once, within 15 minutes of being made, and takes you to set up password sign-in again.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={oneTimeLogin}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

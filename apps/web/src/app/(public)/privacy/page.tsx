import type { Metadata } from "next";
import Link from "next/link";
import { getBranding } from "@/server/branding";
import { getSection } from "@/server/site-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataKept } from "@/components/data-kept";

export const metadata: Metadata = { title: "Privacy" };

// The Discord app's "Privacy Policy URL" (docs/22a §6). Public: Discord shows the link to people who are not signed in.
// The numbers come from Admin → Site → Privacy & data, through the same list the Rules tab shows.
const CHANGED = "16 October 2026";

export default async function PrivacyPage() {
  const [b, privacy, retention] = await Promise.all([getBranding(), getSection("privacy"), getSection("retention")]);
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Privacy</h1>
        <p className="mt-1 text-sm text-muted-foreground">What {b.name} keeps about you, who can see it, and how long it stays. Last changed {CHANGED}.</p>
      </div>
      <Card>
        <CardContent className="space-y-2 pt-4 text-sm">
          <p>{b.name} is a private Minecraft server for a group of friends, run as a hobby by Alex. Nothing is sold, there are no adverts, and nothing about you is handed to anyone for money.</p>
          <p>The site, the Windows app and the Discord bot keep only what they need to let you in, keep the game running, and show the group who is playing.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            <li><strong>Signing in with Discord:</strong> your Discord account&apos;s id and name. Each time you sign in, the site looks at the list of your Discord servers to check you are in the group&apos;s one. It keeps only the answer (yes or no), never the list.</li>
            <li><strong>Signing in with email</strong> (only if you were let in by an invite link without Discord): your email address and your password, stored scrambled so nobody can read it back.</li>
            <li><strong>Minecraft:</strong> your Minecraft name and the id that goes with it, which the site looks up from Mojang. Signing in to Minecraft itself is between you and Microsoft; the site never sees your Microsoft password.</li>
            <li><strong>The app on your PC:</strong> the name of the PC it was signed in on, and how strong the PC is (what you picked, or what the app measured), so the game gets the right settings.</li>
            <li><strong>Votes:</strong> what you voted for, so the result can be counted and you can change your mind while the vote is open.</li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What is kept, and for how long</CardTitle>
          <CardDescription>These numbers are the site&apos;s current settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataKept privacy={privacy} retention={retention} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Discord</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            <li>If you are in the group&apos;s Discord server, what you say in the game&apos;s public chat can be posted in its chat channel, under your Minecraft name and head, and what people write in that channel can be shown in the game. Private messages and party chat are never posted.</li>
            <li>Joins, deaths, votes and news are posted in the Discord server too.</li>
            <li>When you press a vote button or use one of the bot&apos;s commands in Discord, the bot matches your Discord account to your account here. Nothing else you write in Discord is kept by the site.</li>
            <li>Everyone who plays gets a role in the Discord server, so they can be mentioned together. The bot adds and removes it by itself.</li>
            <li>Anything posted in Discord is also kept by Discord, under Discord&apos;s own privacy policy.</li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Other services that see a little</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-6">
            <li><strong>Discord</strong>, for signing in, the bot and the posts above.</li>
            <li><strong>Mojang</strong> (Microsoft), asked once for the id of your Minecraft name.</li>
            <li><strong>Modrinth</strong>, where the app downloads the mods from. Like any download, Modrinth sees your PC&apos;s internet address.</li>
            <li><strong>Crafatar</strong> and <strong>mc-heads.net</strong>, which draw your Minecraft head from your Minecraft id for the site, the app and Discord.</li>
          </ul>
          <p>No tracking or analytics services, and no adverts. The country your address belongs to is looked up in a file on the site&apos;s own server: the address is sent nowhere.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cookies</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>One cookie keeps you signed in. A short-lived one remembers an invite link while you sign in with Discord, and a few short-lived ones keep the sign-in itself safe. No tracking cookies.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Where it is kept, and who sees it</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            <li>On the site&apos;s own server and on the computer that runs the game. Backups of the site and the world are kept for about a month, some of them away from both, and then deleted.</li>
            <li>Admins can see everything on this page. Other players see who is online, play times{privacy.analyticsForPlayers ? " and stats" : ""}, deaths and advancements. Your connection address, your chat history and your PC&apos;s details are for admins only.</li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Getting it removed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Ask an admin, in the Discord server or in the game. Removing you from the group deletes your account here straight away: your linked Minecraft account, your installer reports, and the app&apos;s sign-ins on your PCs.</p>
          <p>What stays: when you played and under which Minecraft name, so the group&apos;s stats still add up (the address you connected from still goes after {retention.ipDays} days), and the admins&apos; own log, which keeps a line saying you were removed, with your names. The rest of the event log goes when its time above runs out, and backups after about a month. Messages already posted in Discord stay there until someone deletes them; an admin can do that for you.</p>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        See also the <Link href="/terms" className="underline">terms</Link>. If this page changes in a way that matters, the change log in the Discord server says so.
      </p>
    </div>
  );
}

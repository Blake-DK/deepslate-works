import type { Metadata } from "next";
import Link from "next/link";
import { getBranding } from "@/server/branding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Terms" };

// The Discord app's "Terms of Service URL" (docs/22a §6). Public: Discord shows the link to people who are not signed in.
// The server's own rules stay on Getting started → Rules (Admin → Branding), behind the sign-in.
const CHANGED = "16 October 2026";

const PARTS: Array<{ title: string; points: React.ReactNode[] }> = [
  {
    title: "Who it is for",
    points: [
      "Invited friends only. You get in through the group's Discord server or an invite link from Alex.",
      "You need your own Minecraft: Java Edition account. One person per account: don't share your sign-in, on the site or in the app.",
    ],
  },
  {
    title: "Playing",
    points: [
      <>The server&apos;s rules, on <strong>Getting started → Rules</strong> once you are signed in, are part of these terms. In short: be decent, play fair, and don&apos;t break things for other people.</>,
      "Admins can let people in and remove them. Usually there is a word first; for something serious, there may not be.",
      "Minecraft's own rules (the Minecraft EULA and Mojang's usage guidelines) apply here too, and Discord's terms apply in the Discord server.",
    ],
  },
  {
    title: "The world and your things",
    points: [
      "Worlds are played in seasons. At the end of a season the world can be reset, and what you built or carried may not come with you.",
      "Backups are taken, but things can still break or be lost. Nothing lost can be paid back, because nothing is paid for.",
      "The server is up when it can be. It may be down for updates, for repairs, or because nobody is playing and it is asleep.",
    ],
  },
  {
    title: "The app and the mods",
    points: [
      "The Windows app puts the mods, NeoForge and the server's settings on your PC and keeps them up to date. You can uninstall it at any time.",
      "The mods are made by their own authors, under their own licences, and are downloaded from Modrinth. The server only picks which ones to use.",
      "The site, the app and the bot are given as they are, with no promises. Use them at your own risk: as far as the law allows, nobody running them is responsible for any loss or damage from using them.",
    ],
  },
  {
    title: "Money",
    points: ["None. There is nothing to buy, no paid ranks and no adverts."],
  },
  {
    title: "Not official",
    points: ["NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT. Not made by Discord or Modrinth either."],
  },
  {
    title: "Changes and questions",
    points: [
      "These terms can change. If they change in a way that matters, the change log in the Discord server says so.",
      "Questions: ask an admin, in the Discord server or in the game.",
    ],
  },
];

export default async function TermsPage() {
  const b = await getBranding();
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Terms</h1>
        <p className="mt-1 text-sm text-muted-foreground">How {b.name} works, for everyone who plays. Last changed {CHANGED}.</p>
      </div>
      <Card>
        <CardContent className="pt-4 text-sm">
          <p>{b.name} is a private Minecraft server for a group of friends, run as a hobby by Alex. By using the site, the app, the Discord bot or the server, you agree to what is below.</p>
        </CardContent>
      </Card>
      {PARTS.map((part) => (
        <Card key={part.title}>
          <CardHeader>
            <CardTitle>{part.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-6 text-sm">
              {part.points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </CardContent>
        </Card>
      ))}
      <p className="text-center text-sm text-muted-foreground">
        What the site keeps about you is on the <Link href="/privacy" className="underline">privacy page</Link>.
      </p>
    </div>
  );
}

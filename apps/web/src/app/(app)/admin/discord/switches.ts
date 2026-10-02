import type { Section } from "@/shared/settings";

// docs/21 §4: the switches on the card, each with an example of its line (the real words are in api's discord/lines.ts).
type Key = Exclude<keyof Section<"discord">, "paused">;
export const SWITCHES: ReadonlyArray<{ key: Key; title: string; example: string }> = [
  { key: "deaths", title: "Deaths", example: "samoyedx: was blown up by Creeper. From the third death in five minutes, the last line counts them instead." },
  { key: "joins", title: "Joins and leaves", example: "samoyedx: joined · 3 online. Leaving and coming back within two minutes is not posted." },
  { key: "challenges", title: "Challenges", example: "samoyedx: completed the challenge Monster Hunter" },
  { key: "advancements", title: "All advancements", example: "samoyedx: made the advancement Stone Age. Noisy in the first week of a world." },
  { key: "votes", title: "Votes", example: "One message per vote: the question and its options, \"0 of 6 have voted\" kept up to date, then the result." },
  { key: "mentionUnvoted", title: "Mention people who have not voted", example: "A day before a vote closes: \"Still to vote: @a @b\". Off: \"2 people still to vote\", no names." },
  { key: "season", title: "Season", example: "Season 1 · First Blood has begun. Posted once the season is built (docs/20)." },
  { key: "news", title: "News", example: "A news item's text and picture, when an admin posts one." },
  { key: "live", title: "We're live", example: "Deepslate Works is open. Press Play at deepslate.dsw.test" },
  { key: "serverUpDown", title: "Server up and down", example: "The server is restarting for an update. Back in about a minute. / The server is back. Sleeping and waking are not posted." },
  { key: "pack", title: "New pack", example: "New pack: 3 mods changed. The app updates it when you press Play." },
  { key: "problems", title: "Crashes and problems", example: "To the admin channel: The server crashed at 21:04. Open Admin → Server. The feed only hears \"The server fell over\"." },
  { key: "firstJoin", title: "First join ever", example: "samoyedx is in. Welcome!" },
];

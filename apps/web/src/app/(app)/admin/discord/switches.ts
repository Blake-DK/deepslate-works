import type { Section } from "@/shared/settings";

// docs/21 §4: the switches on the card, each with an example of its line (the real words are in api's discord/lines.ts).
type S = Section<"discord">;
type Bools = { [K in keyof S]: S[K] extends boolean ? K : never }[keyof S];
type Key = Exclude<Bools, "paused" | BotKey>;
type BotKey = "voteButtons" | "chatToDiscord" | "chatToGame" | "commands";
/** docs/22 §13: where a switch's lines go once the forum season-updates is in use. */
export const UPDATES: ReadonlySet<string> = new Set(["votes", "mentionUnvoted", "season", "news", "live"]);
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

// docs/22 §7: the bot's own switches.
export const BOT_SWITCHES: ReadonlyArray<{ key: BotKey; title: string; example: string }> = [
  { key: "voteButtons", title: "Vote buttons", example: "Polls are posted by the bot in season-updates with a button per option; a press votes for the member whose Discord account pressed it." },
  { key: "commands", title: "Slash commands", example: "/online, /status, /votes, /season, /me, /wake; for the portal's admins /restart, /cancel-restart, /say and /feed." },
  { key: "chatToDiscord", title: "Chat, game → Discord", example: "What linked players say in the game shows in the chat channel, as them with their head. Players let in without the Discord server are not relayed." },
  { key: "chatToGame", title: "Chat, Discord → game", example: "What people write in the chat channel shows in the game as [Discord] name: text, while somebody is on. Leave off until it has been tried in the game." },
];

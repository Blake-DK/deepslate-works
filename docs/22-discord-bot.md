# 22 · The Discord bot

Planner, 2026-10-02. Input for the VPS session: read it, build it in the order of §10, record deviations in `docs/11-status.md`. It builds on docs/21 (the feed), which stays as it is.

## 1. Why and what it is

docs/21 made the server talk to Discord. This makes Discord talk back. Alex, 2026-10-02, asked for all four things docs/21 §9 left out:

- **Vote in Discord**: buttons under the vote's message.
- **Two-way chat**: what is said in the game shows in a Discord channel and what is said in that channel shows in the game.
- **Slash commands**: `/online`, `/status` and a few more.
- **Leaving the Discord server bites within minutes**, not at the next sign-in (docs/14, open since September).

All four need a bot in the group's Discord server. A webhook can only post.

## 2. Decisions

Alex, 2026-10-02:

1. Vote buttons, two-way chat, slash commands and the membership check are all wanted.

Planner's defaults, change them if Alex says otherwise:

2. **The bot is the Discord app that already exists** (the one the site's sign-in uses), with a bot user added. One app, one name, one picture.
3. **Everything comes over the bot's own outgoing connection** (Discord's gateway), from `api`. No public address for Discord to call, nothing new on `web`, no change to Caddy. docs/21 §9 said voting would need an interactions address on `web`: it does not, and this replaces that sentence.
4. **The webhooks stay.** The feed keeps posting through them, because only a webhook can post as the player with their head. The bot posts what must carry buttons (votes) and answers commands.
5. **Two channels, both exist already** (Alex, 2026-10-02): the text channel **#game-chat** for chat and the everyday lines, and the forum channel **season-updates** for votes and season posts. §13 says what goes where; it also changes where docs/21's lines go. This overrides docs/21 decision 3 (one feed channel) and decision 6 ("no game chat in Discord").
6. **Who you are in Discord is who you are on the portal**: the account's `discordId`. A vote or a command from somebody whose Discord account is not on the portal is answered with "Sign in at deepslate.dsw.test once, then try again." Nothing is typed, nothing is linked by hand.
7. **Admin commands follow the portal's roles, not Discord's.** A Discord role or "Administrator" gives nothing here.
8. **With no bot token set, nothing changes.** docs/21 works exactly as today.

## 3. How it works

```
                 ┌──────────── gateway (outgoing websocket) ────────────┐
Discord  ◄──────►│ api: discord/gateway.ts → bot.ts                     │
                 │   button, menu      → votes   (the site's vote rule) │
                 │   slash command     → commands (read, or an action)  │
                 │   message in #chat  → action chat.fromDiscord → game │
                 │   member left       → the door's membership check    │
                 └──────────────────────────────────────────────────────┘
game chat → CHAT event → Announcer (docs/21) → chat webhook → #chat
```

- New files in `apps/api/src/discord/`: `gateway.ts` (connect, identify, heartbeat, resume, reconnect with back-off), `bot.ts` (what each event does), `commands.ts`, `votes.ts`, `chat.ts`. REST calls with the bot token go through `webhook.ts`'s neighbour `rest.ts`: with it, those two files are the only code that calls Discord.
- **Dependency.** The gateway needs a websocket client. Planner's preference: a small client of our own on `ws` (identify, heartbeat, resume and reconnect are about 200 lines) over `discord.js`, which brings a cache and a framework we do not need. If the builder takes a library, the reason goes in the PR as the working rules asks.
- **Intents:** Guilds, Guild Messages, Message Content (privileged), Guild Members (privileged). Both privileged ones are switches in the Developer Portal (§8); a bot in one small server needs no review for them. If the gateway closes with 4014 (an intent not switched on), the card says which and the bot runs without that part.
- **Only the group's server.** Every event from a guild other than `DISCORD_GUILD_ID` is dropped. Commands are registered for that guild only (they appear at once and nowhere else).
- **A dead gateway never slows anything else**: its own loop, its own failures, as the Announcer. `/health` gains `discordBot: "on" | "off" | "refused" | "reconnecting"`.
- **The bot's status line** (presence): "3 online", "Asleep, press Play to wake it", "Switched off". Changed when the server's state word or the count changes, at most once a minute.
- Every reply to a button or a command is **ephemeral** (only the person who pressed sees it), except where §6 says otherwise.

## 4. Votes in Discord

For polls (`Poll`). The season's mod ballot stays a link to the site: it is a page of mods, not a question.

- **Who posts.** With the bot on, the vote's message (docs/21 §5) is sent by the bot, not by the webhook, because only the bot's own messages can carry buttons. Same words, same embed, same edits, same `DiscordPost` row (it gains `via: "webhook" | "bot"`; an edit uses the way it was posted). A poll opened while the bot was off keeps its webhook message and has no buttons.
- **Single choice:** one button per option, "I don't mind" last and grey, five to a row. **Multiple choice:** a select menu ("Pick as many as you like") and nothing else.
- **Pressing:** the vote is stored for the member whose Discord account pressed, by **the same rule the site uses** (`apps/web/src/server/polls.ts`). That rule moves to where both can call it or api calls it through one function; one rule, one set of tests, not a copy. Event `poll.vote` with `via: "discord"` in `meta`.
- **The answer**, only to them: "You voted for **The Harbinger**. You can change it until it closes." and the results so far, as the site shows them after a vote. Pressing another button changes the vote, as on the site.
- **The door.** A member held in the entrance room for a must-vote poll is let in by a Discord vote exactly as by a site vote: the room's 5-second round reads the same table.
- Not on the portal: the line of decision 6. Poll closed: "This vote has closed." and the buttons are removed when the message turns into the result.
- The count in the footer and the reminder work as in docs/21. The reminder's mention now also says "Vote with the buttons above".
- **The app and the site** are unchanged: a vote cast in Discord shows there as any other.

## 5. Two-way chat

The channel is **#game-chat**, picked on the card (§7).

**Game → Discord.** From `CHAT` events, through the Announcer, through the #game-chat webhook (`DISCORD_WEBHOOK_FEED`, §13), as the player with their head, the text and nothing else. Linked players only, as every feed line. Same escaping as docs/21 §3; nobody can be pinged from the game.

- Several lines inside a second are sent as one message per player, so a busy evening stays under Discord's limit.
- The stale rule is 2 minutes for chat: old chat is not replayed.
- Chat relay needs chat logging (Admin → Site settings → Privacy). With logging off there are no `CHAT` events and the card says "Chat relay is off because chat logging is off."
- Private messages (`/msg`, party chat) are not chat events and never leave the game. Verify with a real `/msg` and an Open Parties and Claims party message before this ships.

**Discord → game.** A message in the chat channel, from a person (never from a bot or a webhook, which is also what stops a loop), becomes one chat line in the game:

> `[Discord] Pabulum: anyone on tonight?`

- **This is the one place where a person's free text goes to the console**, so it has its own action, `chat.fromDiscord`, and its own rules. The line is a `tellraw @a[tag=verified]` whose text is one JSON string built by `JSON.stringify`, with a cleaner of its own (the registry's `chatSafe` cuts at 40 characters and drops question marks, too strict for chat): no selector, no click event, no hover event, no translation key, no NBT. Before that: one line only (line breaks become spaces), control characters and `§` removed, at most 256 characters with "…" after that. A test feeds it quotes, backslashes, `"}],` and a line break followed by `/op` and asserts that exactly one console line leaves and that it is a `tellraw`.
- **The name** is the member's Minecraft name when their Discord account is on the portal, their Discord display name otherwise (cleaned the same way, at most 32 characters). `[Discord]` in blue, the name in white, the text in grey.
- Mentions become names (`@Pabulum`, `#general`), custom emoji become `:name:`, a picture or a file becomes "[picture]" or "[file]", a reply adds nothing. Links are shown as text and cannot be clicked.
- **Nobody online: nothing is sent** and the server is not woken. Discord chat is not kept for later.
- At most 1 line a second per person and 5 a second in all; what is over is dropped and the bot adds a 🐌 reaction to the dropped message.
- A message that was relayed gets nothing; the channel stays clean. A message that was not (server asleep) gets nothing either, but the bot's status line says "Asleep".
- Not logged as a `CHAT` event (it is Discord's text, Discord keeps it). The action is audited as `chat.fromDiscord` with the member and the length, not the text.
- In the game's entrance room: `@a[tag=verified]` already leaves out those who are held.

## 6. Slash commands

Registered for the group's server at start (`PUT /applications/<id>/guilds/<guild>/commands`), from one list in `commands.ts`. Words are the planner's.

| Command | Who | Answer |
|---|---|---|
| `/online` | anyone | "3 online: Bramble09, samoyedx, m1owl" or "Nobody is on. The server is asleep and wakes when you press Play." Shown to the channel |
| `/status` | anyone | The site's state word and line, TPS when running, the pack's version, "Open the site". Shown to the channel |
| `/votes` | anyone | Open votes with a link to each one's message, and which you have not answered |
| `/season` | anyone | The line Home shows (docs/20 §7), and your points. "No season is running yet." until docs/20 step 3 exists |
| `/me` | members | Your Minecraft name, last played, hours this month, your installed app and pack versions and whether they are current |
| `/wake` | members | Wakes a sleeping server, the same decision and debounce as Play (`POST /server/wake`, `via: "discord"`): "Waking the server, about 30 s." |
| `/restart minutes:[1-30]` | admins | The planned restart with its in-game countdown, the same action as Admin → Server. Shown to the channel |
| `/cancel-restart` | admins | Calls it off |
| `/say text:` | admins | An announcement in the game, the existing announcement action with its existing validation |
| `/feed pause` / `/feed resume` | admins | docs/21's Pause |

- Every command that changes something is an existing action or route, with its existing permission check and audit, `via: "discord"` in `meta`. No command sends text to the console except through an action that already takes it.
- "Members" and "admins" are the portal's (decisions 6 and 7). A command refused says why in one line.
- `/whitelist` from the old roadmap is not built: the entrance room made it unnecessary.
- No command gives the console, files, inventories or anything else that is admin-only on the site and is not in this table.

## 7. Membership, and the settings card

**Membership.** With `DISCORD_BOT_TOKEN` set, the five-minute check that already exists in `players/limbo.ts` starts working; nothing to build. Added: when the gateway says a member left the server (`GUILD_MEMBER_REMOVE`), that member is checked at once, so they are back in the entrance room within seconds if they are playing, and held at their next join if not. The event line stays docs/14's.

**Admin → Site settings → Discord** gains a "Bot" part above the feed's switches:

- State: "The bot is connected as Deepslate Works#1234" / "No bot token set" / "Discord refused the token" / "Switch on Message Content Intent in the Developer Portal".
- **Add the bot to the server**: a link built from `DISCORD_CLIENT_ID` with scopes `bot applications.commands` and the permissions View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History, Add Reactions. Shown until the bot is in the server.
- **Chat channel**: a list of the server's text channels (read by the bot); Alex picks #game-chat. Channel ids are not secrets and live in `Setting` `discord`. Empty = no chat relay.
- **Updates forum**: a list of the server's forum channels; Alex picks season-updates. The bot posts votes there (§13).
- Switches: Vote buttons, Chat game → Discord, Chat Discord → game, Slash commands, each with a line of what it does. All on by default once the bot is connected, except the two chat ones, which wait for a chat channel to be picked.
- The docs/21 line "Posting through the webhook "<name>"" becomes "Posting to #channel" by itself (status, deviation 2).

**Secrets**, in `deploy/.env` and `.env.example`:

```
# The bot of the Discord app above (Developer Portal → Bot → Reset Token). With it: vote buttons, chat relay,
# slash commands, and leaving the Discord server is noticed within seconds (docs/22). Empty = none of that.
DISCORD_BOT_TOKEN=
# A webhook of the forum channel season-updates: votes and season posts go through it (docs/22 §13).
DISCORD_WEBHOOK_UPDATES=
```

`DISCORD_BOT_TOKEN` exists already; only its comment changes. `DISCORD_WEBHOOK_FEED` (docs/21) is now the #game-chat webhook and its comment says so. api also needs `DISCORD_CLIENT_ID` (the application id, not a secret) passed in by compose.

## 8. What Alex does once

1. **Developer Portal** (discord.com/developers/applications) → the Deepslate Works app → **Bot**: Reset Token and copy it. On the same page switch on **Message Content Intent** and **Server Members Intent**. Switch off "Public Bot" so nobody else can add it.
2. In Discord, two webhooks, each by Edit channel → Integrations → Webhooks → New webhook, both named "Deepslate Works": one in **#game-chat** (`DISCORD_WEBHOOK_FEED`) and one in the forum **season-updates** (`DISCORD_WEBHOOK_UPDATES`). Copy both URLs.
3. Hand the token and the two URLs to the VPS session for `deploy/.env`, then `deploy/deploy.sh`.
4. Admin → Site settings → Discord → **Add the bot to the server**, pick the server, Authorise.
5. On the same card pick #game-chat as the chat channel and season-updates as the updates forum.

## 9. Rules that stay

- `web` posts nothing and listens to nothing; `api` holds the bot.
- No free text reaches the console except through `chat.fromDiscord` (§5) and the existing announcement action, each validated and audited.
- Nothing admin-only on the site becomes readable in Discord.
- The bot acts in one server and ignores every other, direct messages included.
- Nobody is pinged by the bot except the vote reminder of docs/21.
- Plain English, British spelling, written for the friend who has never played modded.

## 10. Order of work

1. **The gateway and the card**: connect, stay connected, the bot's status line, the Bot part of the card, `discordBot` in health, the membership event. Report the reconnect behaviour watched over one night.
2. **Slash commands** (§6), the read-only ones first, then the admin ones.
3. **Vote buttons** (§4), with the vote rule in one place.
4. **Chat, game → Discord** (§5).
5. **The two channels** (§13): the forum posts for votes and season moments, the everyday lines to #game-chat. Step 3's votes are posted the §13 way from the start.
6. **Chat, Discord → game** (§5), last, with its test list. Tried by Alex in the game before the switch is left on.

## 11. Done when

- [ ] With no token, nothing differs from docs/21 and health says `discordBot: "off"`.
- [ ] The bot survives a restart of api, an hour without network and Discord closing the connection: it resumes or reconnects by itself and does not post anything twice.
- [ ] A poll opened on the site shows in Discord with buttons. A member's press stores their vote, shows on the site and in the app, and lets them out of the entrance room within seconds. A second press changes it. Somebody not on the portal gets the sign-in line and no vote is stored.
- [ ] A multiple-choice poll takes two options from the menu in one go.
- [ ] A line said in the game appears in the chat channel as that player with their head within 3 seconds; a `/msg` and a party message do not.
- [ ] A line said in the chat channel appears in the game as `[Discord] name: text`; the bot's and the webhook's own messages do not come back; with nobody on nothing is sent and the server stays asleep.
- [ ] The injection test of §5 passes: one console line, a `tellraw`, whatever the text.
- [ ] `/online` and `/status` say what the site says. `/restart` from a member who is not an admin on the portal is refused, whatever their Discord role; from an admin it runs the same audited action as the site with "via Discord" in the event log.
- [ ] A member who leaves the Discord server while playing is back in the entrance room within 10 seconds.
- [ ] Each switch off means that part is off, and the feed of docs/21 is untouched by any of them.

## 12. Open, for Alex

1. ~~The chat channel.~~ Answered 2026-10-02: #game-chat for chat, the forum season-updates for votes and season posts (§13).
2. **Who may talk into the game**: anybody who can write in the chat channel (default), or only people whose Discord account is on the portal.
3. **Admin commands**: `/restart`, `/cancel-restart`, `/say` and `/feed` are in. Say if any should go or if one is missing.
4. **Deaths, joins and challenges in #game-chat** (§13): the planner's reading, because that is where they show in the game. Say if they should go somewhere else or nowhere.
5. **News** as posts in season-updates (§13), or kept out of the forum.

## 13. Where things go (Alex, 2026-10-02, later the same day)

Two places, and this section also re-routes docs/21's lines. `lines.ts` already returns a channel per message ("feed" or "admin"); it gains a third, "updates".

| Goes to | What |
|---|---|
| **#game-chat** (text channel, `DISCORD_WEBHOOK_FEED`) | Game chat both ways (§5). Deaths, joins and leaves, challenges, first join ever, server up and down, new pack, the crash line. In short: what shows in the game's own chat, shows here |
| **season-updates** (forum channel, `DISCORD_WEBHOOK_UPDATES`, and the bot) | Votes. Every season moment of docs/21 §6. News and "We're live" |
| the private admin channel (`DISCORD_WEBHOOK_ADMIN`) | Unchanged: crashes and problems |

**A forum channel has posts, not lines.** Each post is a thread with a title, so the routing is by post:

- **A vote is one post.** Title: the question (at most 100 characters). First message: the vote's embed with its buttons. The count is edited on that message, the reminder and the result are replies in the same post, and the first message turns into the result as before. When the vote closes the post is left open for talk; it is not locked.
- **A boss is one post**, made the first time something happens to that boss in a season. Title: "Ignis · Season 1". First message: who it is, where, the hint and its points, from the season file. Replies in it: "has awoken", "has fallen, first on the server, to …", later kills. So the whole story of one boss is one thread. A new boss or mob added to the pack mid-season by the planner gets its post when the season file names it ("New this week: …").
- **A trial is one post**, made when it opens. Replies: who is first through, the rest as short lines.
- **A season is one post**, made at its start: "Season 1 · First Blood". Replies: the new leader, the server goal's milestones, a week to go, the finale reminder, the end with the top three, the Frontier's reset. Pinned in the forum while the season runs, if the bot is there to pin it.
- **News** is a post per item, titled by its first line. "We're live" is a post.
- **Tags.** If the forum has tags named Vote, Boss, Trial, Season or News, the post gets the matching one. The bot does not create or change tags; Alex makes them if he wants them.

**How a post is made.** By webhook: the first message is sent with `thread_name`, and Discord answers with the new thread's id; replies go to the same webhook with `thread_id`. By the bot (votes, because of the buttons): a thread created in the forum with its first message. Either way the thread id is kept on the `DiscordPost` row (new column `threadId`), keyed `poll:<id>`, `boss:<season>:<id>`, `trial:<season>:<id>`, `season:<id>`, `news:<id>`. Verify both calls against Discord before building on them; if a webhook cannot start a forum post the way this says, report.

- A post that was deleted by hand in Discord: the next reply fails with "unknown channel"; make the post again once and carry on, do not retry in a loop.
- Without the bot, votes are still posted in the forum by the webhook, without buttons, with the link to the site.
- Without `DISCORD_WEBHOOK_UPDATES`, the updates lines are not posted anywhere. They do not fall back to #game-chat.
- **Chat from Discord into the game is read from #game-chat only.** What people write in the forum's posts stays in Discord.
- The card's switches stay as they are; each now shows where its lines go ("to #game-chat", "to season-updates").
- Done when, added to §11: a vote opened on the site appears as a new post in season-updates with buttons and its result lands in the same post; a boss woken and killed is one post with two replies; a death shows in #game-chat and not in the forum; nothing written in a forum post reaches the game.

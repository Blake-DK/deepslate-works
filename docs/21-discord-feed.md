# 21 · The Discord feed

Planner, 2026-10-02. Input for the VPS session: read it, build it in the order of §10, record deviations in `docs/11-status.md`.

## 1. Why and what it is

The group lives in Discord, not on the site. Today nothing the server does reaches it: a vote opens, somebody dies to a creeper, a boss falls, and the only people who know are the ones already in the game. This puts the server's life into one Discord channel so that the people who are not playing see a reason to.

Three things, in Alex's words (2026-10-02):

- **Votes** in the chat: a vote opens, how many have voted, the result.
- **Death messages** in the chat.
- **Season moments**: "the boss has awoken", a boss falls, a trial opens, a season starts and ends.

Plus the small things that come for free from the event log: who joined, challenges completed, news.

This is the first half of ROADMAP Phase 5, pulled forward on Alex's word. It is **one way: server to Discord**. Chat relay, slash commands and voting inside Discord are §9, not built now.

## 2. Decisions

Alex, 2026-10-02:

1. Votes, deaths and season moments go to Discord.

Planner's defaults, change them if Alex says otherwise:

2. **Webhooks, not a bot.** Posting lines needs no bot, no gateway connection and no permissions in the server. A webhook also lets each line carry its own name and picture, so a death shows the player's head. `DISCORD_BOT_TOKEN` stays what it is today (the membership check) and is not needed for any of this.
3. **One channel for the feed**, and optionally a second, private one for admins (crashes and problems).
4. **Everything is posted from the event log.** Nothing new listens to the console. If it is not an `Event` row, it does not reach Discord; if a line is wanted in Discord, it becomes an event first. One place decides the words.
5. **Nobody is pinged**, with one exception an admin can switch off: the reminder before a must-vote poll closes mentions the members who have not voted.
6. **No game chat in Discord** in this doc. Chat is logged for 30 days and admin-only on the site; relaying it changes who can read it and belongs with the two-way relay (§9).
7. **Old news is not posted.** After an outage, a death from an hour ago is dropped, not replayed.

## 3. How it works

```
web ─┐                      ┌─ feed webhook   (#deepslate)
     ├─► Event table ─► api: Announcer ─┤
api ─┘   (and Poll, Announcement)       └─ admin webhook  (#deepslate-admin, optional)
```

- New module `apps/api/src/discord/`: `announcer.ts` (the loop), `lines.ts` (event → message, pure, tested), `webhook.ts` (the only place that calls Discord, with a timeout, as `amp/` is for AMP).
- The Announcer runs in `api`, which already reaches `discord.com` for the membership check. **Verify first** that api can reach `discord.com` from inside the tunnel namespace (the membership call has never run: no token is set). If it cannot, report; do not move the poster into `web` unasked.
- It reads `Event` rows after a cursor (`Setting` `_discordCursor`, the last event id handled), every 3 s. For each row `lines.ts` returns nothing, or a message for the feed, the admin channel or both.
- **Stale rule:** a row older than 10 minutes when it is read is skipped, except the kinds marked *keep* in §4 (votes, season, news), which are posted up to 24 hours late.
- **First run:** the cursor starts at the newest event. Switching the feed on never posts history.
- **Failures:** on 429 wait what Discord says (`retry_after`) and try again; on a network error or 5xx try 3 times with a pause, then leave the cursor where it is and try at the next round. A 404 or 401 from the webhook (deleted or wrong URL) switches the feed off, writes one `ERROR` event "Discord feed: the webhook was refused" and shows it on the settings card. Never more than 1 message a second to one webhook.
- **Messages that are edited later** (a vote's count and result, §5) need the message id: table `DiscordPost` (`id`, `key` unique such as `poll:<id>`, `channel`, `messageId`, `postedAt`, `editedAt`). Post with `?wait=true` to get the id; edit with `PATCH /webhooks/<id>/<token>/messages/<messageId>`. Only keyed messages get a row.
- Every request carries `allowed_mentions: { parse: [] }`. The one exception is the vote reminder (§5), which lists the user ids it means and nothing else. `@everyone` and `@here` can never come out of this.
- Names and death texts come from the game. Before they are put in a message: Markdown characters escaped, `@` followed by a zero-width space, links not turned into previews (`flags: 4`, suppress embeds, on plain lines).
- No address, no `raw`, no `meta` beyond what §4 names, ever leaves for Discord. The feed is the players' view: a kind that is admin-only on `/events` goes to the admin channel or nowhere.
- **Unlinked players are not named.** Somebody held in the entrance room who has not linked is not a member yet: no join, leave or death line for them.

**Who the message is from.** Player lines (join, leave, death, challenge) are sent with `username` = the Minecraft name and `avatar_url` = their head, from the same source the site uses for heads. Everything else is from the server's name (`branding.name`) with `/brand/logo-256.png`; while no logo is picked, the webhook's own picture.

## 4. What is posted

One table, and it is also the list of switches on the settings card. Words are the planner's; `lines.ts` holds them and nothing else does.

| Switch | From | Default | Line |
|---|---|---|---|
| Deaths | `DEATH` | on | The game's own sentence, as the player with their head: "was blown up by Creeper". See below for runs of deaths |
| Joins and leaves | `JOIN`, `LEAVE` | on | "joined · 3 online" / "left · 2 online". A leave within 2 minutes of the join is not posted and a rejoin within 2 minutes of a leave is not posted (crashes and relogs) |
| Challenges | `ADVANCEMENT`, `how: challenge` | on | "completed the challenge **Monster Hunter**" |
| All advancements | `ADVANCEMENT`, any | off | "made the advancement **Stone Age**". Noisy in the first week of a world, so off |
| Votes | polls and the mod ballot, *keep* | on | §5 |
| Season | season events, *keep* | on | §6 |
| News | a new `Announcement`, *keep* | on | The news item's text and picture, as the server. Not for the items the portal writes by itself for a vote or a season (those have their own message) |
| We're live | the event the "We're live" switch writes, *keep* | on | "**Deepslate Works is open.** Press Play at deepslate.dsw.test" |
| Server up and down | `SERVER_START`, `SERVER_STOP` after a planned restart or an admin stop | on | "The server is restarting for an update. Back in about a minute." / "The server is back." Sleeping and waking are not posted: they happen all day |
| New pack | `SYNC` that changed the pack's version | on | "New pack: 3 mods changed. The app updates it when you press Play." The count from the lock's difference, never the list |
| Crashes and problems | `CRASH`, `ERROR`, the webhook refusal | admin channel, on | "The server crashed at 21:04. Open Admin → Server." Nothing in the feed but, for a crash only: "The server fell over. Alex has been told." |
| First join ever | `LINK` `link.bind` | on | "**samoyedx** is in. Welcome!" once per member |

**Deaths, without flooding.** Each death is a line. From the third death of the same player inside 5 minutes, no new line: the player's previous death message is edited to end with "· and 2 more times since" (kept by a `DiscordPost` row keyed `deaths:<uuid>`, forgotten after 5 quiet minutes). A group wipe at a boss is not collapsed: different players.

**Death messages from mods.** TaCZ, Cataclysm and Mowzie's Mobs have their own death sentences. The line is whatever `events/parse.ts` already stored as the `DEATH` event, so nothing new is parsed here; if a modded death is missing from the event log, the fix is a pattern in `parse.ts` with a test against the real line, as always.

**Quiet hours:** none. A channel can be muted by whoever wants quiet; the server does not decide that.

## 5. Votes

For polls (`Poll`) and for the season's mod ballot (`Vote`). One message per vote, kept up to date, so the channel has one place to look and not a line per ballot.

- **Opened:** an embed in the server's accent colour. Title: the question. Body: the options as a list (text only; a mod option shows the mod's name), "Closes Friday 9 Oct, 20:00 UK" or "Open until an admin closes it", "You need to vote before you can play" when `mustVote`, and a link "Vote" to `deepslate.dsw.test/votes`. For the mod ballot the link goes to the ballot. Footer: "0 of 6 have voted".
- **While open:** the footer's count is edited when a vote comes in, at most once a minute. **Never who voted and never for what**: only the number. The result is not shown before it closes, as on the site.
- **Reminder:** 24 hours before a closing date, if anybody has not voted: a new message "The vote closes tomorrow at 20:00. Still to vote: @a @b". Mentions are real (`allowed_mentions.users` with exactly those Discord ids), members with a Discord account only, admins included. Only for votes with a closing date. Switch "Mention people who have not voted", default on; off makes it "2 people still to vote" with no names.
- **Closed:** the first message is edited to show the result (each option with its count and a bar of block characters, the winner in bold, "I don't mind" last) and "Closed". A second, new message is posted so the channel sees it: "**The vote is closed: Next boss** · The Harbinger won with 4 of 6". A tie says so and names both. For the mod ballot: "Season 1 mods: 9 mods are in" and the link to `/pack`.
- A poll closed and deleted, or one that never opened (draft): nothing.
- Source: the events `poll.open`, `poll.vote`, `poll.close` (and the ballot's `vote.open`, `vote.close`) are already written; the Announcer reads the poll itself for options and counts so the words cannot drift from the site.

## 6. Season moments

This replaces the last sentence of docs/20 §7 "Words on the site and in the event log" ("with the Discord bot (Phase 5)…"): the same lines go to Discord through this feed. It needs docs/20 steps 3 and 4 to exist; until then this section is not built.

docs/20 gains one event kind, `SEASON`, visible to players on `/events` (added to `PLAYER_KINDS`), written by the season recorder for each of these. Each is an embed in the season's accent colour with the season's icon:

| Moment | When | Line |
|---|---|---|
| Season starts | at `startsAt` | "**Season 1 · First Blood has begun.** Six weeks, a trial every week." and the link to `/season` |
| Trial opens | at its `opensAt` | "**Trial opened: The Small Gate** · 15 points" and its hint |
| **Boss awoken** | see below | "**Ignis has awoken.** samoyedx and m1owl are in the fight." |
| Boss falls, first on the server | first `SeasonClear` for that boss | "**The Elder Guardian has fallen**, first on the server, to samoyedx, m1owl and Bramble09. 10 points each." with the three heads |
| Boss falls again | a later clear | a plain line, no embed: "Rowan beat the Elder Guardian" |
| Trial done, first | first clear | "**samoyedx** is first through **The Small Gate**" |
| Server goal | at 25, 50, 75 and 100 % | "Server goal: 50 of 100 boss kills. Half way." |
| New leader | the top of the scoreboard changes hands, at most once a day | "**m1owl** takes the lead with 85 points" |
| A week to go, and the finale | 7 days and 24 hours before `endsAt`, 1 hour before `finale.at` | "The Dragon, together: tonight at 20:00 UK" |
| Season ends | End season pressed | "**Season 1 has ended.** Bramble09 wins with 140 points." then the top three and the link to the hall of fame |
| Frontier wiped | after the wipe | "The Frontier has been reset. Season 2's is open." |

Group lines name everybody who got the tick (docs/20: within 48 blocks), in one message, not one each: the recorder waits 5 seconds after the first clear of a boss before it writes the `SEASON` event, so the names are together.

**"The boss has awoken".** The game has no line for a fight beginning, so the season datapack makes one. This is an addition to docs/20 §4:

- For each ladder boss, `build seasons` also writes an advancement `deepslate:<season>/wake/<boss>`: trigger `minecraft:player_hurt_entity` with that entity type (check the trigger name and its condition shape on the server, as with every id in docs/20), `announce_to_chat: true`, `show_toast: false`, `hidden: true`, title "Woke <boss title>". Titles follow docs/20's rule: unique across seasons, the build fails on a duplicate.
- The console then prints the ordinary advancement line, which `events/parse.ts` already reads. In the game it shows in chat as "samoyedx has made the advancement [Woke Ignis]", which is wanted: the people playing see it too.
- The season recorder knows the title belongs to a wake, not a clear: no points, no `SeasonClear`. It writes one `SEASON` event "boss awoken" for the first wake of that boss and adds the names of everyone who wakes it in the next 30 seconds; after that, no second "awoken" for the same boss for 15 minutes.
- So that it can happen again another evening: the wake advancement is taken back (`advancement revoke … only …`) from everyone within 48 blocks when the boss dies (in the kill advancement's reward function), and from a player 15 minutes after they got it (a scoreboard timer in the season datapack's tick function; the builder may choose another way with the same effect).
- A wake is posted for a boss of the current season only, and also in the month before Season 1 if Alex wants it then (§11, question 3).
- The All advancements switch never posts a wake line twice: season titles are taken out of the plain advancement lines.

## 7. Settings, and what Alex does once

**Secrets.** A webhook URL is a password for the channel: anybody who has it can post there. They live in `deploy/.env`, never in the database and never shown on a page:

```
# Discord feed (docs/21). A webhook of the channel the server posts to. Empty = no feed.
DISCORD_WEBHOOK_FEED=
# Optional: a webhook of a private channel for crashes and problems.
DISCORD_WEBHOOK_ADMIN=
```

Both in `.env.example` with these comments, in api's `env.ts`, and in `/api/health` as `discordFeed: "on" | "off" | "refused"` (never the URL).

**Admin → Site settings → Discord** (`Setting` `discord`, in `shared/settings.ts` with the schema):

- State on top: "Posting to #deepslate" (the channel's name from `GET` on the webhook), or "No webhook set. Ask the VPS session to add DISCORD_WEBHOOK_FEED.", or "Discord refused the webhook."
- The switches of §4, each with its example line under it, and "Mention people who have not voted".
- **Send a test message** to each channel: "This is a test from Deepslate Works. If you can read it, the feed works." Audited `discord.test`.
- **Pause the feed** (for a test evening or a world reset): nothing is posted and nothing is queued; the cursor moves on.
- The last 20 messages sent, with their time and whether Discord took them.

Changing a switch is audited (`discord.settings`), as every setting is.

**Alex, once** (goes into the status's to-do list):

1. In Discord: the channel the feed goes to → Edit channel → Integrations → Webhooks → New webhook. Name it "Deepslate Works", copy the URL.
2. The same in a private admin channel, if wanted.
3. Hand both URLs to the VPS session for `deploy/.env`, then `deploy/deploy.sh`.
4. Admin → Site settings → Discord → Send a test message.

## 8. Rules that stay

- `web` still has no route to the homelab and posts nothing itself: it writes events, `api` posts.
- Every call to Discord goes through `apps/api/src/discord/webhook.ts`, with a timeout, as every AMP call goes through `amp/`.
- The feed never sends anything *to the game*. No new console command, no new action in the registry, apart from the wake advancement's datapack functions (docs/20's `season.reload` carries them).
- A dead webhook or a Discord outage never slows the recorder, the door or a page: the Announcer is its own loop and its failures are its own.
- UI copy and every Discord line in plain English, British spelling, written for the friend who has never played modded.

## 9. Not now

Each of these needs a bot with more than a token (a gateway connection or a public interactions address) and a decision from Alex:

- **Voting inside Discord**: buttons under the vote's message, the vote counted for the member whose Discord account pressed it. Needs the Discord app's interactions address on `web` and signature checking. The cleanest next step after this doc if the group votes more in Discord than on the site.
- **Two-way chat**: game chat into a channel and the channel into the game. Needs the gateway and the rule "no free text from a player reaches the console" thought through for Discord text.
- **Slash commands** (`/online`, `/season`), a status message that edits itself, a voice-channel name with the player count, scheduled events with reminders.

## 10. Order of work

1. **The pipe**: env, `webhook.ts`, the Announcer with the cursor, stale rule and failure handling, the settings card with the test message and pause. Joins, leaves, deaths (with the run rule), challenges, server up and down, crashes to the admin channel. *This is useful on its own and can ship before the world is made again.*
2. **Votes** (§5): the kept-up message, the count, the reminder, the result. `DiscordPost` and its migration.
3. **News, We're live, New pack, First join ever.**
4. **Season moments** (§6), with docs/20 step 3 and 4: the `SEASON` kind, the lines, the 5-second gathering of names.
5. **Boss awoken** (§6): the wake advancements in `build seasons`, the revoke, the recorder's rule. Tried on the sample season with a vanilla boss (the Elder Guardian or the Warden) before any Cataclysm boss.

## 11. Done when

- [ ] With no webhook set, nothing changes anywhere and health says `discordFeed: "off"`.
- [ ] Send a test message arrives in the channel; a wrong URL shows "Discord refused the webhook" on the card and one `ERROR` event, not one per attempt.
- [ ] A linked player dies: the line is in the channel within 5 seconds with their name and head. An unlinked player in the entrance room: nothing.
- [ ] Five deaths of one player in two minutes are two lines and one edited line, not five.
- [ ] api stopped for 20 minutes while people play: when it comes back, the deaths of those 20 minutes are not posted; a poll opened in that time is.
- [ ] A death message containing `@everyone` or a Markdown link (named sword) pings nobody and shows as plain text. Test in `lines.test.ts`.
- [ ] A poll opened on the site appears as one message; three votes change its count and nothing else; closing it turns that message into the result and posts the result line. The reminder mentions exactly the members who have not voted.
- [ ] Discord answers 429: the message arrives after the wait, once.
- [ ] Killing a ladder boss with two players near is one message naming both. Hitting a ladder boss posts "has awoken" once, not once per hit and not once per player.
- [ ] Every switch off means that line is not posted; Pause posts nothing and replays nothing afterwards.
- [ ] `lines.ts` has a test for every row of §4 and §6 against a real `Event` row taken from the database, not a made-up one.

## 12. Open, for Alex

1. **One channel or two?** Everything in one feed channel (default), or deaths and joins in one and votes and season in another. Two more webhooks and a "where" picker per switch if so.
2. **Voting in Discord** (§9): wanted next, or is a link to the site enough?
3. **"Has awoken" before Season 1**: only for bosses that count in the running season (default), or for every boss from day one.
4. **Joins and leaves**: on by default here. Say if the channel should stay for the bigger moments only.

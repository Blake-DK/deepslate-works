# 50 · Invited players' chat stays in the game

Alex, 2026-10-10: a player who was invited without the Discord server can chat in the game as normal, but what they
say is not copied to Discord.

## 1. The rule

A player's chat stays in the game when both are true:
- `User.outsideAuth` is true (they came in by an invite, or an admin picked "Let in without the Discord server").
- They are not in the Discord server now: `discordId` is null or `guildMember` is false. `guildMember` defaults to
  true, so a null `discordId` must be checked on its own.

An invited player who has since joined the Discord server is relayed like everybody else, with no admin step.
Everybody else is unchanged.

## 2. What changes

- Game → Discord chat only (docs/22 §5). `Announcer.chat` in `apps/api/src/discord/announcer.ts` returns without
  posting for such a player. The event is treated as handled: no retry and the feed's position moves on.
- The lookup is `store.member` in `apps/api/src/discord/store.ts`, which today returns only the user id. Give the
  chat path what it needs to apply §1 (a field on the result or a second method, your choice). The other callers of
  `member` must behave exactly as before.
- docs/22 §5 gets one line saying this, pointing here.

## 3. What does not change

- The player's chat in the game: everybody on the server sees it as before.
- The `CHAT` event is still written when chat logging is on. Activity and the admin pages show it as before.
- Discord → game: lines from #game-chat still reach every verified player, invited ones included.
- Deaths, joins, leaves, advancements and first-join lines for these players still post as today.
- No in-game message to the player, no new setting, no migration, no change to the door.
- The test instance stays silent as before (`DISCORD_TALKS`).

## 4. Admin wording

- Admin → Discord, the "Chat game → Discord" switch: add to its line "Players let in without the Discord server
  are not relayed."
- The member menu's question for "Let <name> in without the Discord server?": add "Their game chat will not be
  posted to Discord."

## 5. Tests (apps/api/tests/discord-feed.test.ts)

With chat relay on and a chat channel picked, one CHAT event each:
1. Ordinary member (Bramble09): posted.
2. Invited, no Discord account (KaneFinch, `outsideAuth` true, `discordId` null): not posted, the position moves on,
   no retry.
3. Invited, has a Discord account, not in the server (`guildMember` false): not posted.
4. Invited, now in the server (`guildMember` true, `discordId` set): posted.
5. A death of the player in case 2 is still posted.
6. A burst of lines from the player in case 2 followed by a line from Bramble09: only the second is posted.

## 6. Done when

- [ ] Tests 1 to 6 pass, with typecheck and lint.
- [ ] On live after the deploy: an invited player says a line in the game. It shows in the game and not in
      #game-chat. A Discord member's line said in the same minute does show. This needs a real invited player
      online. The test server cannot show it because it has no bot.
- [ ] Activity shows the invited player's line as a normal chat event.

## 7. Public repo

Placeholders only (Bramble09, KaneFinch). No real names, ids or addresses in code, tests, docs or commit messages.

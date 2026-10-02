# 22a · Setting up the Discord bot and channels

For Alex, once. What docs/22 §8 asks, click by click, and what to check afterwards. About fifteen minutes. Nothing here can be done from the VPS: it needs your Discord account.

What you end up with:

| Where | What it is for | Made in step |
|---|---|---|
| The bot (the existing Deepslate Works app) | Vote buttons, slash commands, chat both ways, noticing someone leaving the Discord server | 1 |
| Webhook in **#game-chat** (`DISCORD_WEBHOOK_FEED`) | Game chat and the everyday lines: deaths, joins, server up and down, new pack | 2 |
| Webhook in the forum **season-updates** (`DISCORD_WEBHOOK_UPDATES`) | Votes, news, "We're live", later the season's posts | 2 |

## 1. The bot's token and switches

1. Open https://discord.com/developers/applications and pick **Deepslate Works** (the app the site's sign-in uses; do not make a new one).
2. Left menu → **Bot**.
3. **Reset Token** → confirm → **Copy**. Keep it somewhere safe for step 3; Discord shows it only once. If it is lost, reset it again (the old one stops working).
4. Further down on the same page, under **Privileged Gateway Intents**, switch on:
   - **Server Members Intent** (so leaving the Discord server is noticed within seconds),
   - **Message Content Intent** (so what is written in #game-chat can reach the game).
   Press **Save Changes**.
5. Under **Authorization Flow**, switch **Public Bot** off, and **Save Changes**. Nobody but you can then add the bot anywhere.

The token is a password: anyone who has it can act as the bot. Send it only to the VPS session, and reset it if it ends up anywhere else.

## 2. The two webhooks

For each of the two channels:

1. In Discord, hover the channel → the cog (**Edit Channel**) → **Integrations** → **Webhooks** → **New Webhook**.
2. Click the new webhook, name it **Deepslate Works** (the picture does not matter: the site sets one per message), **Copy Webhook URL**, then **Save Changes**.

Make one in **#game-chat** and one in the forum **season-updates**. Keep the two URLs apart: which is which matters.

A webhook URL is a password for its channel: anybody who has it can post there. If one leaks, delete the webhook in the same place and make a new one.

Optional: in season-updates, forum tags named **Vote** and **News** (Edit Channel → Tags) are put on the matching posts. Later the season uses **Season**, **Boss** and **Trial**. The bot never makes tags itself.

## 3. Hand them to the VPS session

Send the VPS session, in one message:

- the bot token (step 1),
- the #game-chat webhook URL,
- the season-updates webhook URL.

It puts them in `deploy/.env` as `DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_FEED` and `DISCORD_WEBHOOK_UPDATES` and runs `deploy/deploy.sh`. `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` are already there from the site's sign-in. The bot needs PR #50 merged and deployed; say "merge 50" in the same message if it is not merged yet.

## 4. Add the bot to the server

1. On the site: **Admin → Site settings → Discord**. The Bot part should say "The bot is connected as Deepslate Works…, but it is not in the server yet."
2. Press **Add the bot to the server**. Discord opens with the group's server already picked.
3. Leave the permissions ticked as they are and press **Authorise**.
4. Reload the card: it now says the bot is connected, without "not in the server", and shows the channel lists.

If the card says **"Switch on Message Content Intent and Server Members Intent"**, step 1.4 was not saved: switch them on, save, and the bot picks them up at its next reconnect (or ask the VPS session to restart api).
If it says **"Discord refused the token"**, the token was copied wrong or reset since: do step 1.3 again and hand over the new one.

## 5. Pick the channels

On the same card, in the Bot part:

1. **Chat channel** → **#game-chat**.
2. **Updates forum** → **season-updates**.
3. Leave **Chat, Discord → game** off for now (see check 4 below). Press **Save**.

## Checks afterwards

1. **Send a test message** (top of the card): a line in #game-chat.
2. **Test season-updates**: a new post "Test from Deepslate Works" in the forum. This is the first time the site starts a forum post through a webhook; if it fails, the card says why. Tell the VPS session either way, and delete the test post afterwards.
3. In Discord, type `/status` in any channel: the bot answers with the server's state. `/online` lists who is on.
4. **Chat both ways, in the game.** Say something in the game: it shows in #game-chat as you, with your head. Send a `/msg` to someone and a party message: neither must show in Discord (tell the VPS session if one does). Then switch **Chat, Discord → game** on, write in #game-chat while you are in the game, and see `[Discord] Bramble09: …` in the game's chat. If it looks right, leave the switch on; if not, switch it off and tell the VPS session what you saw.
5. **A vote.** Open a small poll on the site (Admin → Votes): a post appears in season-updates with a button per option. Press one: only you see "You voted for …", and the site shows your vote.

## If something goes wrong

- **Everything to do with Discord can be paused** on the card (**Pause the feed**) or with `/feed pause`. The bot's own parts each have a switch in the Bot part.
- **Take the bot away completely:** ask the VPS session to empty `DISCORD_BOT_TOKEN` and redeploy. The site then works as it did before docs/22.
- The card's **Last messages sent** list shows what Discord refused and why.

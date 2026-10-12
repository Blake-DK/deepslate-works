# 57 · Testers: a normal player on the test server without being an admin

Planner, 2026-10-12. Alex: "add a way for me to add a normal player to the test server without them being admin".
This is the "tester tick for non-admins" queued in docs/45 and listed open in docs/49. Alex, the same day: he turns
it on and off for a person with one click.

## 1. Why it does not work today

Three doors keep everyone but admins out of the test server, on purpose (docs/42 §3, docs/45):

1. **The app's Test tab** shows only when the live home says the sign-in is an admin's. `/api/app/test` with its
   three sub-routes answers non-admins as a path that does not exist (`appAdmin` in `src/server/test-app.ts`).
2. **The test instance's whitelist** (`white-list=true`, `enforce-whitelist=true`): a name not on it is refused.
3. **The test door's link.** A first join on the test server asks for a link to an account on the **test site**. The
   test site is behind Caddy's live-admin check. A non-admin cannot open the link, so they would wait in the
   entrance room for good.

## 2. What Alex gets

- On the **live** site, Admin → People: a **Tester** switch on each member. **One click turns it on or off**: it saves
  at once, with no Save button and no confirm step. The row shows "Tester since <date>" or nothing. On means: the
  Test tab appears in their app, they are on the test server's whitelist and the test door lets them straight in. Off
  undoes all three.
- They play the test server as a normal player: survival, no console, no op, no Builder mode, no admin pages.
- They never see the test site. It stays admins only, unchanged.
- The Test server card on Admin's first page lists the testers, each with the same switch, so one can be turned off
  from there with one click too.

## 3. How

**Live database.** `User.tester Boolean @default(false)`, one migration. Admins count as testers without the switch.
The switch can only be set on a member with a linked Minecraft account (`mcUuid` and `verifiedAt` set); otherwise the
switch is greyed with "Link their Minecraft account first". Every change is audited as `user.tester` (on/off, by whom).
Removing a member, blocking them, or their leaving the Discord server (the existing paths) sets it off.

**The app's routes.** `appAdmin` becomes `appTester` for the four `/api/app/test` routes: admin, or `tester` true,
read from the database per request as today. `POST /api/app/test/wake` follows the same rule (Alex, T2). Every
`test.app.*` log line names whether it was an admin or a tester.

**The home.** `/api/app/home` gains `test: true` for admins and testers. `admin` stays as it is and keeps every
admin-only part of the app (the Start button) for admins only.

**The app.** The Test tab shows when `test` is true (today: when `admin` is true). Nothing else changes. This is an
app release: folded into 3.6.2 if 3.6.2 has not been built for Alex yet, otherwise 3.6.3. **It goes to no tester until
Alex has tried it on his own PC**, as every app build does. An app older than this version keeps showing the tab to
admins only, so a tester needs the new app.

**The test server's side.** The live web tells `api-test` about each switch change over the internal network, with the
token `TEST_APP_TOKEN`, on one new path `POST /test/app/tester` `{ uuid, name, on }`. That widens the token's list of
paths from four to five: write it into docs/38 and the token's comment in `api-test`. On it, `api-test`:

- **On:** upserts the player in `deepslate_test` as a linked, verified member (`mcUuid`, `mcUsername`, `verifiedAt`
  now, `guildMember` true, `outsideAuth` true, role PLAYER, no sign-in of any kind), so the test door's `decideJoin`
  releases them with no link; then `whitelist add <name>` on the test instance.
- **Off:** `whitelist remove <name>`, a kick if online, the row's `verifiedAt` cleared so the door would hold them.
- **The test instance sleeps when empty**, so a command may have nowhere to go. `api-test` keeps the tester list it
  was given and, at every start of the test instance, makes the whitelist match it (adds the missing, removes testers
  that were turned off; never touches admins or names it did not add). The live web sends the whole list again at
  each `api-test` start as well, so the two cannot drift.

**Not op.** Nothing here writes `ops.json` or uses `op`. The check below confirms a tester cannot use admin commands.

## 4. Alex's answers (2026-10-12)

| # | Question | Answer |
|---|---|---|
| T1 | Can testers open the test site? | **No, admins only as now** |
| T2 | Can testers wake the sleeping test server from the app? | **Yes, as admins can** |

A tester sees whatever the test server runs, Season 1's content included. Pick testers who are happy to keep it to
themselves.

## 5. Work, one feature PR to `dev`

| # | Who | What | Size |
|---|---|---|---|
| T-a | VPS | Migration, the one-click switch on Admin → People and on the Test server card with its audit, `appTester`, the home's `test`, `POST /test/app/tester`, the reconcile at start and the full list at `api-test` start, docs/38 updated. Tests | M |
| T-b | VPS | The app: the Test tab on `test`. CI builds it; the exe goes to Alex | S |
| T-c | Alex | Tries the app on his own PC: his Test tab still there, live Play unchanged | S |
| T-d | Alex, one friend | The checks below with a real non-admin | S |

**Checks, each one seen in its real state, not only in unit tests:**

1. A member who is not linked: the switch is greyed with the message.
2. Turn a linked non-admin on with one click (no Save, no confirm). Their app (the new version) shows the Test tab
   within one home check; an older app does not.
3. Their Test Play installs the test pack into the test folder and wakes the server; they join the test
   server, are not asked to link and are not held in the entrance room. `whitelist list` on the test console has them.
4. Switch them on while the test server sleeps: at its next start they are on the whitelist.
5. On the test server they cannot use `/op`, `/gamemode`, `/give` or any admin command; Builder mode is not offered.
6. Opening the test site's address in their browser gives "Admins only".
7. One click off (on People or on the Test server card): kicked within a few seconds if online, off the whitelist,
   the Test tab gone at their next home check, `/api/app/test` answers them as missing.
8. Remove them on live (or block them): the switch goes off and check 7's results follow.
9. The live server and the live site behave for them exactly as before.

Live is not touched by any of this beyond the site deploy; no world, no restart. The deploy itself follows the usual
`dev` → `main` PR on Alex's word.

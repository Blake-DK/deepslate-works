# 45 · The launcher's Test section, version one: admins only (2026-10-09)

Alex's decision and the planner's pre-approved design of 2026-10-09; built by the VPS session. The rehearsal of a pack
change runs through the app, as players use live. Later versions add a tester tick for non-admins (queued).

## Who sees it

Admins only. The app asks the **live** site `GET /api/app/test` with its launcher token. The middleware lets a request
with a launcher token through to the four routes (`lib/test-app-paths.ts`); the route finds the user behind the token,
reads the role from the database, and answers anyone who is not an admin exactly as a path that does not exist: the
middleware's 401 "Sign in first" to an app, Next's 404 to a signed-in browser. A non-admin's app never shows the section.
(First deploy, 2026-10-09: the middleware's list of app routes did not include these, so even an admin's app got the 401;
found by a throwaway non-admin probe on the test web before any player app was given 3.6.0.)

## How an admin's app gets the test pack (no secret in the app, test site unchanged)

| App asks the live site | Live web asks the test api (internal network) |
|---|---|
| `GET /api/app/test`: show or not, state, address, pack | `GET /test/app/state` |
| `GET /api/app/test/manifest`: the test pack in the live manifest's shape | `GET /test/app/pack`, `GET /test/app/state` |
| `GET /api/app/test/config.zip`: the test settings bundle | `GET /test/app/config.zip` (stream) |
| `POST /api/app/test/wake` | `POST /test/app/wake` |
| `GET /api/app/test/wake` (3.6.1): how the wake is going, watched every 5 s | `GET /test/app/wake` |

3.6.1 (`work/app-3-6-1-server`): `GET /api/app/test` also sends `server`, the test server in the site's words in the
home's shape (a state the site's list does not know goes as it is). The test api asks AMP once more before it answers
a wake "unreachable". The game check after a test Play has the mode `test_game_check`, left out wherever `test_play` is
(`TEST_MODES`).

- **The token:** `TEST_APP_TOKEN` in `deploy/.env`, passed to the live web and to `api-test` only. `api-test` takes it
  on these four paths and on nothing else, and refuses to start if it equals the service or the summary token. It never
  reaches the app.
- **No change to Caddy.** The test site stays behind the live admin check. Jars come from the addresses in the test
  lock and are checked against their sha512, as live does.
- **The test manifest** is the live one's shape, with four things changed: the test lock, the test address, the test
  settings bundle (`config_url` on the live site), and the profile `{ id: deepslate-works-test, dir:
  .minecraft-deepslate-works-test, name: "Deepslate Works TEST" }`. `installer` is the live site's, so the app updates
  itself only from the live channel. `test: true`.
- **Logged:** `test.app.manifest` and `test.app.wake` on the live site. `server.wake` on the test server names the live
  admin "through the app's Test section".

## The app

**3.6.1 (what is built now; docs/07 "3.6.1").** The Test tab is the Play tab pointed at the test server: the same view
and code with the target "test" (card, steps, Play, countdown), made only when the home says the sign-in is an admin's.
Play on either tab ends a run of the other's that only waits. Extras, settings, the game check and the launcher profile
follow the target as docs/07 says. **Corrections to version one below:** 3.6.0 did write into the live folder during a
test Play (the extras were synced there; the Settings tab's waiting changes were used up by the test game), its game
check counted in the live figures, and a member's app asked `/api/app/test` every 10 s. The text below is version
one's, kept for the record.

- A Test section, shown only when `GET /api/app/test` answers. It shows the test pack's version and says plainly it is
  the test server. When the stack is off or cannot be reached it says so and does nothing else.
- **Its own Play:** the test manifest, the same steps as live Play (jars not in the manifest removed, Extras kept), the
  wake through the live site, the game started at the test address. Its own game folder and launcher profile, from the
  manifest. Java and the NeoForge install in `.minecraft` are reused, not copied. The live folder is never touched by a
  test Play, nor the test folder by a live Play: every per-pack path (the game folder, `installed.json`, the pack list,
  `options.txt`) follows the run's target.
- **Reports** from a test Play have the mode `test_play`. The door's Play check, Admin → Installs' counts, the player
  pages, `/me`, the PC tier and the "mods missing" check leave them out. The event log keeps them.
- **The app's version** must be plain numbers (for example 3.6.0), or the door would read it as older than the minimum.
  A newer app is never refused: the door asks only for at least the minimum, and the update check offers only newer.

## Delivery

- Built on top of 3.5.6, by CI only. The exe goes to Alex from the run's artifacts page. Players stay on 3.5.5: the live
  deploy pins the app (`INSTALLER_TAG=3.5.5`), and an app updates itself only to a newer version.
- Alex's check: live Play unchanged, the Test section for him, test Play installs the test pack into the test folder and
  joins the test server, the live folder untouched, a non-admin account sees nothing.

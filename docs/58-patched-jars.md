# 58 · A patched mod jar in the pack (first use: the Sculptor crash)

Planner, 2026-10-12. Alex crashed on the test server opening the Sculptor's trade screen (Mowzie's Mobs 1.8.2, the
newest on Modrinth). It is a bug in the mod. A fix was written in Alex's fork; the pack needs a way to ship that jar.

## 1. What is done

- **The cause** (read in the mod's public source, `main` at `7aa1730`, the 1.8.2 update): the client-side trade
  container takes its mob from `MMCommon.PROXY.getReferencedMob()`, which is set only when the client itself runs
  `mobInteract` and reaches `openGUI`. Client and server can disagree on that branch, so the server opens the menu while
  the client has no mob. `GuiSculptorTrade.render` (line 98, `getDesires`) then throws. `GuiUmvuthiTrade` has the same
  pattern and dereferences the mob in its constructor. `GuiUmvuthanaTrade` already checks.
- **The fix**, in Alex's fork `Blake-DK/MowziesMobs-Public`, committed as Alex:
  - branch `fix/trade-screen-missing-mob`, one commit `c9981ca`: both screens guard every use of the mob and close
    themselves on the next tick when there is none. Meant for a pull request to the mod's author (Alex opens it).
  - branch `dsw-build`, `033b998` on top: `mod_version=1.8.2-dsw.1` and `.github/workflows/dsw-build.yml` (Java 21,
    Gradle 8.9, `gradle build`, prints the jar's sha512, uploads the jar as artifact `mowziesmobs-jar`). Not for
    upstream.
- **Built:** run 38262710258 on the fork, success. Artifact `mowziesmobs-jar`, about 36 MB zipped. Its sha512 is in the
  run's log (the step `sha512sum build/libs/*.jar`).
- **Not proven:** nobody has run the patched jar. It has not been compared with 1.8.2 beyond the two files changed.

## 2. The license and why the jar stays private

Mowzie's Mobs is "All Rights Reserved" with a custom license (`License.txt` in its repo). Private modpacks and
direct editing are private use, outside its terms. Faithful changes are allowed; the mod's name and credit stay.
So: **the patched jar is never published.** No GitHub release, no public URL, nothing in the public repo. Members get
it only through the site's gated downloads, as they get the manifest.

## 3. What to build: a pinned private jar

A mod in `mods.json` may say where its file comes from instead of Modrinth:

```jsonc
"source": { "private": "mowziesmobs-1.21.1-1.8.2-dsw.1.jar", "sha512": "<from the CI log>", "note": "docs/58: Sculptor crash fix" }
```

- **The file** lives on the VPS in a git-ignored folder (`data/private-jars/`, mounted read-only where Build and the
  web need it). It is put there by hand from the CI artifact, its sha512 checked against the lock before anything
  uses it.
- **Lock** writes the entry with `filename`, `sha512`, `size` from the file on disk and a URL on the **site itself**,
  `/downloads/mods/<filename>`. No Modrinth lookup for that mod. The entry keeps `side`, `season` and the mod's other
  fields. A changed sha512 is a diff Lock prints like any version change.
- **Where it may be fetched from:** `mod-url.ts` today allows `cdn.modrinth.com` only. It gains exactly one more host,
  the site's own (from `AUTH_URL`, never from the lock) and only for paths under `/downloads/mods/`. Lint and the
  tests say so. The PC app's own host check (read `installer/` for it) gets the same single addition.
- **Serving:** `/downloads/mods/<filename>` behind the same gate as the manifest and `/downloads/*`: a launcher token
  or a signed-in member, players only while the rules for downloads allow it, admins always. Only files named in the
  current lock; anything else is a 404. Logged.
- **Build** copies the file from `data/private-jars/` for the server side, checking its sha512. It fails loudly if
  it is missing or different.
- **Test and live** each read their own `data/private-jars/`. The test stack gets it first; live only with Alex's yes.
- docs/38 gains a line: one more download host, the site itself, for files the site serves.

## 4. Order

1. This feature, its own PR to `dev`, with tests (lock, lint, the host check, the gated route, Build).
2. Download the artifact from run 38262710258 (`gh run download` on the fork, as ladm), check its sha512 against the
   run's log, put the jar in the **test** stack's `data/private-jars/`. Point `mowzies-mobs` at it in `mods.json`
   (still `"season": "s1"`, still `adminOnly`), Lock, Build and Sync on the test site.
3. **Alex on his own PC**, through the app's Test tab: the app downloads the patched jar (Settings or the log shows
   `1.8.2-dsw.1`), the game starts, normal trading with the Sculptor works (the screen shows her wanted item, the
   button works). The crash case closes the screen instead of crashing. If the crash case cannot be made to happen,
   say so; do not claim it was seen.
4. Live: only with Season 1's opening, after a backup and on Alex's yes.
5. **Back to Modrinth** the day the author ships a version with a fix: drop `source`, pin that version, Lock. Check
   Modrinth for a new Mowzie's Mobs version at every Season 1 rehearsal step.

## 5. Checks, each one seen in its real state

1. A lock with a `private` file and a wrong sha512 fails Lock and Build.
2. `/downloads/mods/<filename>` gives 401 without a token, the jar with one, 404 for a name not in the lock.
3. A lock entry with any other host is refused by lint, Build and the app.
4. The test server starts with `1.8.2-dsw.1` (no FATAL) and step 3 of §4 passes on Alex's PC.

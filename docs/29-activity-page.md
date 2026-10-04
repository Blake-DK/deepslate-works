# 29 · Activity: everything first, then filter down

Planner, 2026-10-04. Alex: "the activity page needs to show everything and then you can filter it down instead of what it is now." Input for the VPS session: read it, don't rewrite it. Report in `docs/11-status.md`. Small job, web only, straight to main, no PR; deploy when CI is green.

## 1. What is wrong today

`/activity` opens on a form: a card of tick boxes (19 for an admin), four inputs and a Filter button, with "Nothing ticked means everything" under it. The log is below that and the live rows sit in a second list behind a tick box that starts off. The page already returns everything when nothing is ticked, but it reads as a search form you have to fill in.

**Correction (planner, 2026-10-04, after the build):** "already returns everything" was wrong. Since `7062d40` (2026-09-30) the superseded-rows clause hid every row, so the page and its CSV were empty; that is what Alex was looking at. Fixed in `bf5e9d3` (report in docs/11). I read the query and did not run it.

**Accepted:** Live does not run on an Older page, so new rows never land on top of page 2.

## 2. Rulings

1. **The log is the page.** Heading, one line of words, one row of chips, then the list. Everything the viewer may see is there on arrival, newest first.
2. **Filtering is a chip row, not a form.** The first chip is **Everything** and it is lit on arrival. The others are groups of kinds (§3). Picking a group shows only that group; picking a second adds it; picking a lit one removes it; removing the last one lights Everything again. Everything clears the groups and keeps the other filters.
3. **No Filter button for the chips.** Each chip is a link to the same page with the new query, so it works without JavaScript and a filtered view can still be linked.
4. **Player, dates and words move behind "More filters"**, a `<details>` under the chip row: closed on arrival, open when any of the three is set. Inside it the same four inputs as today and an Apply button. Export CSV (admins) sits in there too and exports what is shown.
5. **What is filtered is said in one line** above the list when anything is narrowed: "Showing deaths and advancements · samoyedx · from 1 Oct · Clear". Clear goes to `/activity`. With nothing narrowed the line is not there.
6. **Live is on by default and feeds the same list.** New rows arrive at the top of the one list. A small "Live" marker with the dot stands at the right of the chip row; clicking it pauses and resumes. No second list.
7. **Who sees what does not change.** Players get `PLAYER_KINDS` and never an address, `raw` or `meta`; admins get every kind and open a row for the console line. "Everything" means everything that viewer is allowed. docs/16 §4 and docs/21 decision 6 stand.
8. **The URL does not change shape.** `kind` (comma list), `player`, `from`, `to`, `q`, `before` as today, so the links from the Control Room, a player's page and old bookmarks still work. A group is only a set of kinds.
9. **Paging stays**: 100 rows and Older.

## 3. The groups

One list in `apps/web/src/lib/event-query.ts` (web only, not in `shared/`), in this order. Every kind in `EVENT_KINDS` is in exactly one group.

| Chip | Kinds | Who |
|---|---|---|
| Joins and leaves | JOIN, LEAVE | everyone |
| Deaths | DEATH | everyone |
| Advancements | ADVANCEMENT | everyone |
| Server | SERVER_START, SERVER_STOP | everyone |
| Chat | CHAT | admins |
| Problems | CRASH, WARN, ERROR | admins |
| Admin actions | ADMIN_ACTION | admins |
| Player actions | PLAYER_ACTION | admins |
| Joining | LINK, JOIN_BLOCKED, REVOKE | admins |
| Pack and installs | SYNC, INSTALL, DOWNLOAD | admins |
| Backups | BACKUP | admins |

- A player's chip row is Everything and the first four. An admin's is all twelve.
- A chip is lit when any of its kinds is in the filter. Clicking a lit chip takes all of its kinds out; clicking an unlit one puts all of them in.
- When a later doc adds a kind (docs/20's `SEASON`), it joins a group or gets one here, and the test below fails until it does.

## 4. What to build

- `lib/event-query.ts`: the group list and one pure function that, given a filter and a group, returns the filter after the click (rule 2 and §3), dropping `before` so a new filter starts at the top. A second pure function for the words of rule 5.
- `components/events/event-page.tsx`: the layout of §2. Chips are Card2 chips in the manner of docs/23's Badge (1 px Line, 3 px corners); the lit ones carry the Copper border and CopperHi text, the same language as the tab strip's current tab. The row wraps on a phone; no sideways scroll. The tick boxes and "Nothing ticked means everything" go.
- `components/events/live-tail.tsx`: on by default, rows put at the top of the page's list and rendered by the same row as the rest (`EventItem`), so a live row looks like any other. For `scope=admin` the stream also sends `raw` and `meta` so an admin can open a live row; the player scope sends neither, as now. Pause while the tab is hidden (`visibilitychange`) and resume from the last id when it is seen again, so a tab left open overnight holds no connection.
- The player's words under the heading stay. The admin's become "Everything the server and the site have seen or done, newest first. Open a row for the console line and the details."
- Nothing in `api`, no migration, no change to `event-log.ts` beyond what the stream needs.

Tests, in the manner of the existing event-query tests:

- every kind in `EVENT_KINDS` is in exactly one group, and the four players' groups hold exactly `PLAYER_KINDS`;
- the click function: from Everything, one group gives only that group; a second adds; a lit one removes; the last one removed gives the empty filter; `before` is dropped; `player`, `from`, `to`, `q` are kept;
- a filter holding one kind of a group (`?kind=JOIN`) lights that group and a click on it removes it;
- a player's filter never gains an admin kind, whatever the query says (the existing guard, kept);
- the stream sends `raw` and `meta` only for an admin with `scope=admin`.

## 5. Done when

- [x] `/activity` with no query shows the log straight away, Everything lit, no tick boxes, Live running.
- [x] As an admin: Deaths shows only deaths; Deaths then Advancements shows both; Everything brings all of it back. The address bar holds the filter and the link opens the same view in another tab.
- [ ] As a player (an account that is not an admin): five chips, no admin group in the page source, no address in any row.
- [ ] A join or a death during the visit appears at the top of the same list without a reload, and an admin can open it for the console line.
- [x] More filters: a player name plus a date narrows the list, the "Showing …" line says so, Clear brings everything back.
- [x] Export CSV with Deaths lit holds only deaths.
- [x] The links from Control Room → recent activity and from a player's page still land on the right rows.
- [ ] On a phone the chips wrap and nothing scrolls sideways.

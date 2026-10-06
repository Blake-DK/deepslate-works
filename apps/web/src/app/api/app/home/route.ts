import { bearer, userFromLauncherToken } from "@/server/launcher";
import { getStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import { getAnnouncements } from "@/server/announcements";
import { newsLink } from "@/lib/news";
import { forClient, pendingFor } from "@/server/polls";
import { env } from "@/env";
import { ukShort } from "@/lib/uk-time";
import { wakeLine } from "@/shared/server-state";
import { VOTE_FIRST_BUTTON } from "@/shared/polls";
import { dashedUuid } from "@/lib/heads";
import { getSeasonCurrent, lineFor } from "@/server/season";

export const dynamic = "force-dynamic";

// Planner 2026-10-02, "the app as the front door": what Deepslate Works shows on its Play tab, asked every 10 s while
// its window is open. The server in the site's words (anyone); with the app's sign-in also who's online, the latest
// pinned news item, the must-vote polls this member has not answered (oldest first), and whether they may Start it.
// Nothing else from the site is repeated in the app.
export async function GET(req: Request) {
  const token = bearer(req);
  const [user, status] = await Promise.all([token ? userFromLauncherToken(token) : Promise.resolve(null), getStatus()]);
  const admin = user?.role === "ADMIN";
  const t = statusText(status, admin);
  const server = {
    state: t.state, line: t.line, label: t.label, tone: t.tone, hint: t.hint,
    wake: { phase: status.wake.phase, leftS: status.wake.leftS, line: wakeLine(status.wake) },
    // admins get a Start button in the app for a server that will not wake by itself (the site's audited start)
    canStart: admin && (status.server === "off" || status.server === "crashed"),
  };
  const site = env.AUTH_URL.replace(/\/+$/, "");
  if (!user) return Response.json({ signedIn: false, site, server }, { headers: { "cache-control": "no-store" } });
  const [news, pending, season] = await Promise.all([getAnnouncements(0), pendingFor({ id: user.id, role: user.role }), getSeasonCurrent().then(lineFor).catch(() => null)]);
  const pinned = news.find((n) => n.pinned) ?? null;
  return Response.json(
    {
      signedIn: true,
      site,
      name: user.displayName,
      admin,
      server,
      online: status.online.map((p) => p.name),
      // 3.4.0 (docs/21 §7): the same players with their UUIDs, so the app can ask /api/app/head/<uuid>.png. A list of
      // its own: apps before 3.4.0 read "online" as names and would show nobody if it became objects
      players: status.online.map((p) => ({ name: p.name, uuid: dashedUuid(p.uuid) })),
      // docs/20 §7 (W1.6): the season in the same one line as the site's Home; null while there is none. Apps that do
      // not know the field ignore it
      season,
      // url (app 3.5.3): where a click on the news card opens; older apps ignore it
      news: pinned ? { body: pinned.body, at: ukShort(pinned.createdAt), author: pinned.author, image: pinned.image ? `${site}${pinned.image}` : null, url: newsLink(site, pinned) } : null,
      votes: {
        polls: pending.polls.map(forClient).map((p) => ({ ...p, options: p.options.map((o) => ({ ...o, imageUrl: o.imageUrl ? `${site}${o.imageUrl}` : null })) })),
        ballot: pending.ballot ? { ...pending.ballot, url: `${site}/pack?tab=vote` } : null,
        order: pending.list.map((p) => ({ kind: p.kind, id: p.id })),
        button: VOTE_FIRST_BUTTON,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

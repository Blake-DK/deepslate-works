import Link from "next/link";
import { signOut } from "@/auth";
import { loadCurrentUser } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { getStatus } from "@/server/status";
import { pillFor, statusText } from "@/lib/server-status";
import { getOpenVote } from "@/server/vote/votes";
import { pendingFor } from "@/server/polls";
import { getSection } from "@/server/site-settings";
import { AdminStrip, BannerBox, NavLink, Strip, TabBadge } from "./nav-link";
import { stripLink } from "./strip-link";
import { getSeasonCurrent } from "@/server/season";

const DOT = { up: "bg-play-hi", waking: "bg-primary", asleep: "bg-dim", down: "bg-danger" } as const;

/** The drawn logo when none is uploaded (docs/23 §4): a slate tile with a Copper "D". Its colours are the brand's own. */
function LogoTile() {
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-[#565C66] font-display text-2xl font-bold text-primary"
      style={{ background: "linear-gradient(135deg, #3E444D, #23272D)", boxShadow: "inset 0 0 0 2px #1C1F24" }}
    >
      D
    </span>
  );
}

/**
 * The page frame (docs/23 §4): the deepslate ground (globals.css), the banner with the name and the server's pill, the
 * tab strip (and the admin strip on admin pages), the page, the footer. Signed out, or not yet onboarded: the banner
 * and the footer only.
 */
export async function AppFrame({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  const [user, brand] = await Promise.all([loadCurrentUser(), getBranding()]);
  const member = !!user?.pcTier;
  const admin = member && user!.role === "ADMIN";
  const [status, vote, privacy, pending, season] = member
    ? await Promise.all([getStatus(), getOpenVote(), getSection("privacy"), pendingFor({ id: user!.id, role: user!.role }).catch(() => null), getSeasonCurrent().catch(() => null)])
    : [null, null, null, null, null];

  const signOutForm = user && (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }} className="contents">
      <button className={stripLink(false)} title={user.displayName}>Sign out</button>
    </form>
  );

  let pill: React.ReactNode = null;
  if (status) {
    const a = statusText(status, admin);
    const p = pillFor(status);
    pill = (
      <span className="inline-flex max-w-full items-center gap-2 rounded-full border bg-[rgba(12,13,16,.8)] px-3 py-1 text-[13px] font-semibold text-foreground" data-testid="nav-status" title={`${a.line}. ${a.hint}`}>
        <span className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full ${DOT[p.dot]}`} aria-hidden />
        <span className="truncate">{p.line}</span>
      </span>
    );
  } else if (user) {
    // not yet onboarded: no server line (as before), but a way out
    pill = <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}><button className="rounded-full border bg-[rgba(12,13,16,.8)] px-3 py-1 text-[13px] font-semibold text-foreground" title={user.displayName}>Sign out</button></form>;
  }

  const banner = (
    <BannerBox>
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at its own size; the optimiser would smooth it */}
      <img src={brand.bannerUrl ?? "/brand/hero.png"} alt="" className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]" style={{ objectPosition: "center 70%" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 35%, rgba(10,12,16,.85))" }} aria-hidden />
      <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-between px-5 pt-3 pb-4">
        <div className="flex min-h-8 justify-end">{pill}</div>
        <Link href="/" className="flex min-w-0 items-end gap-3">
          {brand.logoUrl
            /* eslint-disable-next-line @next/next/no-img-element -- an uploaded logo, already sized; the optimiser does not handle SVG */
            ? <img src={brand.logoUrl} alt="" className="h-12 w-12 shrink-0 object-contain" style={brand.generated?.pixel ? { imageRendering: "pixelated" } : undefined} />
            : <LogoTile />}
          <span className="min-w-0">
            <span className="block truncate font-display text-[26px] leading-none font-bold text-white sm:text-[34px]" style={{ textShadow: "3px 3px 0 #1C1F24" }} data-testid="brand-name">{brand.name}</span>
            <span className="mt-1.5 block truncate text-[13px] text-primary-hi" data-testid={member ? undefined : "tagline"}>{brand.tagline || "A private Minecraft server for friends."}</span>
          </span>
        </Link>
      </div>
    </BannerBox>
  );

  if (!member) {
    return (
      <>
        {banner}
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-[26px] pb-[34px]">{children}</main>
        {footer}
      </>
    );
  }

  const polls = pending?.polls.length ?? 0;
  const stats = admin || privacy!.analyticsForPlayers;
  return (
    <>
      {banner}
      <Strip label="Main">
        <NavLink href="/" exact>Home</NavLink>
        <NavLink href="/map">Map</NavLink>
        <NavLink href="/help">Getting started</NavLink>
        <NavLink href="/mods">Mods guide</NavLink>
        {/* the tab is there once a season has been announced (docs/34 §5) */}
        {season && season.state !== "none" && <NavLink href="/season">Season</NavLink>}
        <NavLink href="/players">{stats ? "Players & stats" : "Players"}</NavLink>
        <NavLink href="/pack" badge={vote ? <TabBadge>vote</TabBadge> : null}>Mods &amp; vote</NavLink>
        <NavLink href="/votes" badge={polls ? <TabBadge>{polls === 1 ? "new" : polls}</TabBadge> : null}>Votes</NavLink>
        <NavLink href="/activity">Activity</NavLink>
        <span className="min-w-4 flex-1" aria-hidden />
        {admin && <NavLink href="/admin" copper>Control Room</NavLink>}
        <NavLink href="/me">Me</NavLink>
        {signOutForm}
      </Strip>
      {admin && <AdminStrip />}
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-[26px] pb-[34px]">{children}</main>
      {footer}
    </>
  );
}

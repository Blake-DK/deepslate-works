import Link from "next/link";
import { signOut } from "@/auth";
import { loadCurrentUser } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { getStatus } from "@/server/status";
import { statusText } from "@/lib/server-status";
import { getOpenVote } from "@/server/vote/votes";
import { pendingFor } from "@/server/polls";
import { getSection } from "@/server/site-settings";
import { MobileMenu, NavLink } from "./nav-link";

const DOT = { good: "bg-accent", info: "bg-info", warn: "bg-primary", bad: "bg-danger", neutral: "bg-muted-foreground" } as const;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * The page frame (docs/13 §11 layout). Signed-in members get the sidebar in four groups (Play, Community, You, and
 * for admins Run the server); under 1024 px it is a drawer behind a Menu button. Everyone else gets a plain header.
 */
export async function AppFrame({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  const [user, brand] = await Promise.all([loadCurrentUser(), getBranding()]);
  const signOutForm = user && (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm hover:bg-muted" title={user.displayName}>Sign out</button>
    </form>
  );
  const brandBlock = (
    <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded logo, already sized; the optimiser does not handle SVG */}
      {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-7 w-auto max-w-32 object-contain" style={brand.generated?.pixel ? { imageRendering: "pixelated" } : undefined} />}
      <span className="truncate">{brand.name}</span>
    </Link>
  );

  if (!user?.pcTier) {
    return (
      <>
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
            {brandBlock}
            <div className="ml-auto flex items-center gap-2">{signOutForm}</div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        {footer}
      </>
    );
  }

  const admin = user.role === "ADMIN";
  const [status, vote, privacy, pending] = await Promise.all([getStatus(), getOpenVote(), getSection("privacy"), pendingFor({ id: user.id, role: user.role }).catch(() => null)]);
  const polls = pending?.polls.length ?? 0;
  const stats = admin || privacy.analyticsForPlayers;
  const a = statusText(status, admin);
  const statusLine = (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="nav-status" title={`${a.line}. ${a.hint}`}>
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[a.tone]}`} aria-hidden />
      <span className="truncate">{a.line}</span>
    </span>
  );
  const nav = (
    <nav aria-label="Main" className="space-y-4">
      <Group label="Play">
        <NavLink href="/" exact>Home</NavLink>
        <NavLink href="/map">Map</NavLink>
        <NavLink href="/help">Getting started</NavLink>
        <NavLink href="/mods">Mods guide</NavLink>
      </Group>
      <Group label="Community">
        <NavLink href="/players">{stats ? "Players & stats" : "Players"}</NavLink>
        <NavLink href="/pack" badge={vote ? <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">vote</span> : null}>Mods &amp; vote</NavLink>
        <NavLink href="/votes" badge={polls ? <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">{polls === 1 ? "new" : polls}</span> : null}>Votes</NavLink>
        <NavLink href="/activity">Activity</NavLink>
      </Group>
      <Group label="You">
        <NavLink href="/me">Me</NavLink>
      </Group>
      {admin && (
        <Group label="Run the server">
          <NavLink href="/admin" exact>Control Room</NavLink>
          <NavLink href="/admin/server">Server</NavLink>
          <NavLink href="/admin/pack">Pack</NavLink>
          <NavLink href="/admin/people" also={["/admin/installs"]}>People</NavLink>
          <NavLink href="/admin/news">News</NavLink>
          <NavLink href="/admin/site">Site settings</NavLink>
        </Group>
      )}
    </nav>
  );
  const foot = (
    <div className="mt-auto flex items-center gap-1 border-t pt-3">
      <span className="min-w-0 flex-1 truncate px-2 text-sm text-muted-foreground">{user.displayName}</span>
      {signOutForm}
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card p-3 lg:flex" aria-label="Sidebar">
        <div className="space-y-1 px-2 pt-1">{brandBlock}{statusLine}</div>
        {nav}
        {foot}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileMenu brand={brand.name} status={statusLine}>
          <div className="space-y-4">{nav}</div>
          <div className="mt-4">{foot}</div>
        </MobileMenu>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        {footer}
      </div>
    </div>
  );
}

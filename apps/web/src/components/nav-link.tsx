"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { stripLink } from "./strip-link";

export function NavLink({ href, also = [], exact = false, badge, copper = false, children }: { href: string; also?: string[]; exact?: boolean; badge?: React.ReactNode; copper?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const on = exact ? path === href : under(href) || also.some(under);
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={stripLink(on, copper)}>
      {children}
      {badge}
    </Link>
  );
}

/** A Copper chip on a tab: "vote", the number of polls waiting. */
export function TabBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[3px] bg-primary px-1.5 py-px text-xs font-semibold text-primary-foreground">{children}</span>;
}

/** One row on Panel under a 1 px Line; scrolls sideways on a phone, never wraps. */
export function Strip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b bg-panel">
      <nav aria-label={label} className="mx-auto flex max-w-6xl overflow-x-auto whitespace-nowrap px-[6px]">
        {children}
      </nav>
    </div>
  );
}

const SITES = ["Live", "Test"] as const;

/** The admin pages' own strip, under the main one on /admin and below (docs/23 §4). */
export function AdminStrip({ other = null }: { other?: { label: "Live" | "Test"; url: string } | null }) {
  const path = usePathname();
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;
  return (
    <Strip label="Run the server">
      <NavLink href="/admin" exact>Control Room</NavLink>
      <NavLink href="/admin/server">Server</NavLink>
      <NavLink href="/admin/joining">Joining</NavLink>
      <NavLink href="/admin/people" also={["/admin/installs"]}>People</NavLink>
      <NavLink href="/admin/pack">Modpack</NavLink>
      <NavLink href="/admin/seasons">Seasons</NavLink>
      <NavLink href="/admin/news">News</NavLink>
      <NavLink href="/admin/votes">Votes</NavLink>
      <NavLink href="/admin/discord">Discord</NavLink>
      <NavLink href="/admin/site">Site</NavLink>
      {/* docs/42 §8: Live | Test, the same page on the other site of the pair; only while there is a test server. Always
          Live then Test on both sites, so the two never trade places: only the highlight moves. */}
      {other && (
        <>
          <span className="min-w-4 flex-1" aria-hidden />
          {SITES.map((label) =>
            label === other.label ? (
              <a key={label} href={`${other.url}${path}`} className={stripLink(false)} data-testid="site-switch-other">{label}</a>
            ) : (
              <span key={label} className={stripLink(true)} aria-current="page" data-testid="site-switch-here">{label}</span>
            ),
          )}
        </>
      )}
    </Strip>
  );
}

/** The banner's box: 176 px (150 on a phone), 260 on the sign-in pages. */
export function BannerBox({ children }: { children: React.ReactNode }) {
  const login = usePathname().startsWith("/login");
  return (
    <header className={cn("relative overflow-hidden border-b-[3px] border-primary bg-panel", login ? "h-[260px]" : "h-[150px] sm:h-[176px]")} data-testid="banner">
      {children}
    </header>
  );
}

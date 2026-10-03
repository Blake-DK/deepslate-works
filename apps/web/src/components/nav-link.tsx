"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** A strip's tab (docs/23 §4): semibold 15, Muted, a 3 px bottom edge that is Copper on the page it names (and the
 *  pages under it, `also`). */
export const stripLink = (on: boolean, copper = false) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-[14px] pt-[13px] pb-[10px] text-[15px] font-semibold",
    on ? "border-primary" : "border-transparent hover:text-foreground",
    copper ? "text-primary-hi" : on ? "text-foreground" : "text-muted-foreground",
  );

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

/** The admin pages' own strip, under the main one on /admin and below (docs/23 §4). */
export function AdminStrip() {
  const path = usePathname();
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;
  return (
    <Strip label="Run the server">
      <NavLink href="/admin" exact>Control Room</NavLink>
      <NavLink href="/admin/server">Server</NavLink>
      <NavLink href="/admin/pack">Pack</NavLink>
      <NavLink href="/admin/people" also={["/admin/installs"]}>People</NavLink>
      <NavLink href="/admin/news">News</NavLink>
      <NavLink href="/admin/site">Site settings</NavLink>
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

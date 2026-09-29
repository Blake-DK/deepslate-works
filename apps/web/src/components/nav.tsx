import Link from "next/link";
import { signOut } from "@/auth";
import { loadCurrentUser } from "@/server/auth/session";
import { ThemeToggle } from "./theme-toggle";
import { getBranding } from "@/server/branding";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/mods", label: "Mods" },
  { href: "/vote", label: "Vote" },
  { href: "/install", label: "Install" },
  { href: "/map", label: "Map" },
  { href: "/players", label: "Players" },
  { href: "/analytics", label: "Stats" },
  { href: "/events", label: "Events" },
  { href: "/rules", label: "Rules" },
  { href: "/me", label: "Me" },
];

export async function Nav() {
  const [user, brand] = await Promise.all([loadCurrentUser(), getBranding()]);
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded logo, already sized; the optimiser does not handle SVG */}
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="h-7 w-auto max-w-32 object-contain" />}
          <span>{brand.name}</span>
        </Link>
        <nav className="ml-2 hidden gap-1 sm:flex" aria-label="Main">
          {user?.pcTier && LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted">{l.label}</Link>
          ))}
          {user?.role === "ADMIN" && (
            <Link href="/admin" className="rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-muted">Admin</Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user && (
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
              <button className="rounded-lg px-3 py-1.5 text-sm hover:bg-muted" title={user.displayName}>Sign out</button>
            </form>
          )}
        </div>
      </div>
      {user?.pcTier && (
        <nav className="flex gap-1 overflow-x-auto border-t px-2 py-1 sm:hidden" aria-label="Main (mobile)">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm hover:bg-muted">{l.label}</Link>
          ))}
          {user.role === "ADMIN" && <Link href="/admin" className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-primary">Admin</Link>}
        </nav>
      )}
    </header>
  );
}

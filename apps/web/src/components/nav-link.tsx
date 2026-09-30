"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** A sidebar entry: highlighted on its own page and on the pages under it (`also`). */
export function NavLink({ href, also = [], exact = false, badge, children }: { href: string; also?: string[]; exact?: boolean; badge?: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  const on = exact ? path === href : under(href) || also.some(under);
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm", on ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}

/** Under 1024 px the sidebar is a drawer behind a Menu button; it closes when a page opens. */
export function MobileMenu({ brand, status, children }: { brand: React.ReactNode; status: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-card px-4 py-2 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="mobile-nav" className="rounded-lg border px-3 py-1.5 text-sm">Menu</button>
        <div className="min-w-0 flex-1 truncate font-semibold">{brand}</div>
        {status}
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close the menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div id="mobile-nav" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r bg-card p-3 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="mb-2 self-end rounded-lg px-3 py-1 text-sm hover:bg-muted">Close</button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

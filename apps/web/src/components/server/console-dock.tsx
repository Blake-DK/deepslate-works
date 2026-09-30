"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LiveConsole } from "./live-console";

/**
 * The console drawer under the admin pages (docs/13 §11 layout): shut by default, opened with one click, and it
 * stays as the admin left it. It connects to the live console only while open. Not on the Control Room or on
 * Server → Console, which have the console on the page itself.
 */
export function ConsoleDock() {
  const path = usePathname();
  const q = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(localStorage.getItem("console-dock") === "open"); } catch {}
  }, []);
  if (path === "/admin" || (path === "/admin/server" && q.get("tab") === "console")) return null;
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem("console-dock", o ? "shut" : "open"); } catch {}
      return !o;
    });
  };
  return (
    <section className="sticky bottom-0 z-20 -mx-4 border-t bg-card px-4 pb-2 pt-1 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]" aria-label="Console" data-testid="console-dock">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 py-1 text-left text-sm font-medium">
        <span className="font-mono text-primary" aria-hidden>&gt;_</span> Console
        <span className="ml-auto text-xs font-normal text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="h-72"><LiveConsole initial={[]} compact /></div>}
    </section>
  );
}

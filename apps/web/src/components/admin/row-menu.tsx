"use client";
import { useEffect, useRef } from "react";
import { menuItem, menuItemDanger } from "./menu-item";

export { menuItem, menuItemDanger };

/**
 * The "…" at the end of a row: what can be done with it, in one place. A <details>, so it opens without any script;
 * the script only closes it again on a click elsewhere or on Escape.
 */
export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    const key = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key === "Escape" && d?.open) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("click", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <details ref={ref} data-row-menu className="relative inline-block text-left">
      <summary aria-label={label} title={label} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-[4px] text-lg leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span aria-hidden>…</span>
      </summary>
      <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 rounded-[4px] border bg-card p-1 text-sm">
        {children}
      </div>
    </details>
  );
}

/** How an entry of the menu looks: a button over the whole width. */

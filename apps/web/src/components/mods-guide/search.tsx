"use client";
import { useEffect, useState } from "react";
import { matches } from "@/lib/mods-guide";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";

// The Mods guide's search box (/mods): hides the cards that don't match and opens the folded "Behind the scenes"
// while searching. A link to /mods#something inside the folded part opens it too.
export function ModsSearch() {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      const details = el?.closest("details");
      if (details) details.open = true;
      if (el) el.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  useEffect(() => {
    let shown = 0;
    document.querySelectorAll<HTMLElement>("[data-mod-card]").forEach((el) => {
      const hit = matches(el.dataset.search ?? "", query);
      el.hidden = !hit;
      if (hit) shown++;
    });
    document.querySelectorAll<HTMLElement>("[data-mod-part]").forEach((part) => {
      const any = part.querySelector("[data-mod-card]:not([hidden])") !== null;
      part.hidden = !any;
      const details = part.querySelector("details");
      if (details && query) details.open = true;
    });
    const none = document.getElementById("mods-none");
    if (none) none.hidden = shown > 0;
  }, [query]);

  return (
    <div className="sticky top-[var(--stripe-h,0px)] z-10 -mx-1 bg-background px-1 py-2">
      <label htmlFor="mods-search" className="sr-only">Search the mods</label>
      <input
        id="mods-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search: a mod, a key, “pipe”, “reload”…"
        className={cn("h-11", fieldClasses)}
        data-testid="mods-search"
      />
    </div>
  );
}

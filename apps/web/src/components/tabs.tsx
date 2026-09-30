import Link from "next/link";
import { cn } from "@/lib/utils";

import { tabHref, type Tab } from "@/lib/tabs";

export { pickTab, tabHref, type Tab } from "@/lib/tabs";

/** A page's title with its tabs under it (docs/13 §11 layout): one h1, then each tab's own h2. */
export function TabbedPage({ title, intro, base, tabs, current, children }: { title: string; intro?: React.ReactNode; base: string; tabs: readonly Tab[]; current: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {intro && <p className="text-muted-foreground">{intro}</p>}
      </div>
      {tabs.length > 1 && (
        <nav aria-label={`${title}: sections`} className="-mx-1 flex gap-1 overflow-x-auto border-b px-1" data-testid="tabs">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={tabHref(base, tabs, t.key)}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                t.key === current ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.count != null && t.count !== "" && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t.count}</span>}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </div>
  );
}

/** Explanations that used to sit on the tools themselves, folded away (they are read once, the tools every day). */
export function HowThisWorks({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <details className={cn("text-xs text-muted-foreground", className)}>
      <summary className="cursor-pointer select-none font-medium text-primary">How this works</summary>
      <div className="mt-1 max-w-prose space-y-1">{children}</div>
    </details>
  );
}

/** What a page receives as `searchParams`, and the looser shape the old pages (now sections) take it in. */
export type PageQuery = Promise<Record<string, string | string[] | undefined>>;
export const asSectionQuery = (q: Record<string, string | string[] | undefined>) => Promise.resolve(q as Record<string, string | undefined>);

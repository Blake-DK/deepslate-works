"use client";
import { useRef } from "react";
import { menuItem, menuItemDanger } from "./row-menu";
import { buttonClasses } from "@/components/ui/button";

type Action = (formData: FormData) => void | Promise<void>;

/** An entry that asks before it does it. */
export function ConfirmItem({ action, fields, question, children }: { action: Action; fields: Record<string, string>; question: string; children: React.ReactNode }) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" role="menuitem" className={menuItemDanger} onClick={(e) => { if (!window.confirm(question)) e.preventDefault(); }}>{children}</button>
    </form>
  );
}

/** "Link by name…": a small dialog with the name and a button. The admin's fallback; accounts link themselves in game. */
export function LinkByName({ action, id, who }: { action: Action; id: string; who: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" role="menuitem" className={menuItem} onClick={() => dialog.current?.showModal()}>Link by name…</button>
      <dialog ref={dialog} className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/40" aria-label={`Link ${who} to a Minecraft account`}>
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <h2 className="truncate text-lg font-semibold" title={who}>Link {who}</h2>
          <p className="text-sm text-muted-foreground">The name is checked with Mojang and linked by hand. Normally accounts link themselves in game.</p>
          <div>
            <label htmlFor={`mc-${id}`} className="mb-1 block text-sm font-medium">Minecraft name</label>
            <input id={`mc-${id}`} name="mcUsername" autoFocus required pattern="[A-Za-z0-9_]{3,16}" maxLength={16} className="h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className={buttonClasses("primary", "sm")}>Link</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

"use client";
import { useRef } from "react";
import { menuItem, menuItemDanger } from "./row-menu";
import { buttonClasses } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { CHAT_RELAY_CHOICES, type ChatRelay } from "@/shared/chat-relay";

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
      <dialog ref={dialog} className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-[4px] border bg-card p-5 text-foreground backdrop:bg-black/40" aria-label={`Link ${who} to a Minecraft account`}>
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <h2 className="truncate text-lg font-semibold" title={who}>Link {who}</h2>
          <p className="text-sm text-muted-foreground">The name is checked with Mojang and linked by hand. Normally accounts link themselves in game.</p>
          <div>
            <label htmlFor={`mc-${id}`} className="mb-1 block text-sm font-medium">Minecraft name</label>
            <input id={`mc-${id}`} name="mcUsername" autoFocus required pattern="[A-Za-z0-9_]{3,16}" maxLength={16} className="h-11 w-full rounded-none border-2 border-edge bg-panel px-3 font-mono text-sm focus-visible:border-primary focus-visible:outline-none" />
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

/**
 * "Game chat to Discord…" (Alex, 2026-10-11): Automatic, Always post or Never post for one member. `now` is what
 * Automatic does for them today, so the admin sees it before picking.
 */
export function ChatRelayItem({ action, id, who, relay, now }: { action: Action; id: string; who: string; relay: ChatRelay; now: "posted" | "kept" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" role="menuitem" className={menuItem} onClick={() => dialog.current?.showModal()}>Game chat to Discord…</button>
      <dialog ref={dialog} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[4px] border bg-card p-5 text-foreground backdrop:bg-black/40" aria-label={`Game chat to Discord for ${who}`}>
        <form action={action} className="space-y-3" onSubmit={() => dialog.current?.close()}>
          <input type="hidden" name="id" value={id} />
          <h2 className="truncate text-lg font-semibold" title={who}>Game chat of {who}</h2>
          <p className="text-sm text-muted-foreground">Whether what they say in the game is posted to the Discord chat channel. Everybody in the game sees it either way.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Game chat to Discord</legend>
            {CHAT_RELAY_CHOICES.map((c) => (
              <label key={c.value} className="flex cursor-pointer items-start gap-3 rounded-[4px] border p-3">
                <Check className="mt-1" type="radio" name="relay" value={c.value} defaultChecked={relay === c.value} />
                <span>
                  <span className="block font-medium">{c.title}</span>
                  <span className="block text-sm text-muted-foreground">{c.example}{c.value === "AUTO" && <> For {who} now: {now === "posted" ? "posted" : "kept in the game"}.</>}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className={buttonClasses("primary", "sm")}>Save</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

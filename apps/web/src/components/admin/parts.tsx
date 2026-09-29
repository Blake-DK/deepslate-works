import { cn } from "@/lib/utils";

/** One line, cut with an ellipsis when it does not fit; the whole of it on hover. */
export function Clip({ text, className, mono = false }: { text: string; className?: string; mono?: boolean }) {
  return <span data-truncate title={text} className={cn("block min-w-0 truncate", mono && "font-mono", className)}>{text}</span>;
}

type Action = (formData: FormData) => void | Promise<void>;

/**
 * A switch: on or off, sent as it is pressed. No script: it is the submit button of a form of its own.
 * `why` is what the pointer shows, also while it cannot be pressed.
 */
export function Switch({ action, fields, on, label, why, disabled = false }: { action: Action; fields: Record<string, string>; on: boolean; label: string; why: string; disabled?: boolean }) {
  return (
    <form action={action} className="inline-flex" title={why}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          on ? "border-accent bg-accent" : "border-border bg-muted",
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        )}
      >
        <span aria-hidden className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
      </button>
    </form>
  );
}

/** A table whose columns are as wide as they are told to be, so that every row lines up and nothing wraps. */
export function FixedTable({ widths, head, children, label }: { widths: string[]; head: Array<{ text: string; right?: boolean; center?: boolean; title?: string; hidden?: boolean }>; children: React.ReactNode; label: string }) {
  return (
    <table aria-label={label} className="w-full table-fixed border-collapse text-sm">
      <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          {head.map((h, i) => <th key={i} scope="col" title={h.title} className={cn("whitespace-nowrap px-3 py-2 font-normal", h.right && "text-right", h.center && "text-center")}>{h.hidden ? <span className="sr-only">{h.text}</span> : h.text}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y">{children}</tbody>
    </table>
  );
}

export const cell = "px-3 py-2 align-middle whitespace-nowrap overflow-hidden";
/** The cell with the "…": what opens from it must not be cut off. */
export const menuCell = "px-1 py-2 align-middle text-right";

/** Under 800 px: one card for each row, the same things in it. */
export function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{name}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2">{children}</dd>
    </div>
  );
}

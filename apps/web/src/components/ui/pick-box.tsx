import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A ballot's or a poll's box (docs/23 §5): a 16 px square, 2 px edge, the dark well, a ✓ in CopperHi when picked. The
 * real input is there for the keyboard and screen readers, out of sight; the box shows its focus.
 */
export function PickBox({ on, className, ...input }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked"> & { on: boolean }) {
  return (
    <>
      <input {...input} checked={on} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border-2 border-edge bg-well text-[11px] leading-none font-bold text-primary-hi",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
          className,
        )}
      >
        {on ? "✓" : null}
      </span>
    </>
  );
}

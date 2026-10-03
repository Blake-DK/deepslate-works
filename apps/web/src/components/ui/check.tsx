import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A checkbox or radio for any form (docs/23 §5): PickBox's 16 px square, 2 px edge, the dark well and a ✓ in CopperHi,
 * but the input keeps its own checked state, so server forms can use `defaultChecked`. Put it inside its <label>.
 */
export function Check({ className, type = "checkbox", ...input }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <>
      <input type={type} {...input} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center border-2 border-edge bg-well text-[11px] leading-none font-bold text-transparent",
          "peer-checked:text-primary-hi peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
          "peer-disabled:border-border peer-disabled:cursor-not-allowed",
          className,
        )}
      >
        ✓
      </span>
    </>
  );
}

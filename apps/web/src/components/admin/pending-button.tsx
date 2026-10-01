"use client";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/button";

/** A submit button that says it is busy while its form's action runs (making a logo's sizes takes a few seconds). */
export function PendingButton({ children, busy, variant = "secondary", formAction, disabled }: { children: React.ReactNode; busy: string; variant?: "primary" | "secondary"; formAction?: (f: FormData) => void | Promise<void>; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const off = disabled || pending;
  return (
    <button type="submit" formAction={formAction} disabled={off} aria-busy={pending} className={buttonClasses(variant, "sm", off ? "pointer-events-none opacity-60" : undefined)}>
      {pending ? busy : children}
    </button>
  );
}

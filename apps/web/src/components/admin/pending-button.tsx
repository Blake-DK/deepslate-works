"use client";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A submit button that says it is busy while its form's action runs (making a logo's sizes takes a few seconds). */
export function PendingButton({ children, busy, variant = "secondary", size = "sm", className, formAction, disabled }: { children: React.ReactNode; busy: string; variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg"; className?: string; formAction?: (f: FormData) => void | Promise<void>; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const off = disabled || pending;
  return (
    <button type="submit" formAction={formAction} disabled={off} aria-busy={pending} className={buttonClasses(variant, size, cn(className, off && "pointer-events-none opacity-60"))}>
      {pending ? busy : children}
    </button>
  );
}

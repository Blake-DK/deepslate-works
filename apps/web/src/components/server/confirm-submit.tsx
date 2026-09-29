"use client";
import { buttonClasses } from "@/components/ui/button";

/** A submit button that asks first. The form is sent only after "OK". */
export function ConfirmSubmit({ question, children, variant = "danger", disabled = false }: { question: string; children: React.ReactNode; variant?: "danger" | "secondary" | "primary"; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={buttonClasses(variant, "sm", disabled ? "pointer-events-none opacity-50" : undefined)}
      onClick={(e) => {
        if (!window.confirm(question)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

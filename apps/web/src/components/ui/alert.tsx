import * as React from "react";
import { cn } from "@/lib/utils";

// docs/23 §5 (docs/21 §3): a card with a 3 px stripe on the left in the tone.
export function Alert({ tone = "info", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "warn" | "error" | "success" }) {
  const tones = {
    info: "border-l-info",
    warn: "border-l-warn",
    error: "border-l-danger",
    success: "border-l-accent",
  };
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-[4px] border border-l-[3px] bg-card px-4 py-3 text-sm text-card-foreground", tones[tone], className)} {...props} />;
}

import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({ tone = "info", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "error" | "success" }) {
  const tones = {
    info: "border-border bg-muted",
    error: "border-danger/40 bg-danger/10 text-danger",
    success: "border-accent/40 bg-accent/10 text-accent",
  };
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)} {...props} />;
}

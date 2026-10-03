import * as React from "react";
import { cn } from "@/lib/utils";

// docs/23 §5: a Card2 chip on a 1 px Line, the tone in the text.
const tones = {
  neutral: "text-muted-foreground",
  good: "text-accent",
  warn: "text-warn",
  bad: "text-danger",
  info: "text-info",
  waking: "text-primary",
} as const;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-[3px] border bg-card-2 px-2 py-px text-[13px] font-semibold", tones[tone], className)} {...props} />;
}

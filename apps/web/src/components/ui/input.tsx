import * as React from "react";
import { cn } from "@/lib/utils";

// docs/23 §5: 44 px, Panel fill, a 2 px edge, square; focus turns the edge Copper. Labels 13 px semibold.
export const fieldClasses = "w-full rounded-none border-2 border-edge bg-panel px-3 text-[15px] text-foreground placeholder:text-dim focus-visible:border-primary focus-visible:outline-none";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-11", fieldClasses, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-11", fieldClasses, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("min-h-11 py-2", fieldClasses, className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-[13px] font-semibold", className)} {...props} />;
}

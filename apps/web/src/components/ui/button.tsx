import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "copper" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

// docs/23 §5: every variant but ghost is a bevelled block (globals.css .block-btn); primary is the launcher's green,
// copper is for voting. ghost stays a plain text button.
const variants: Record<Variant, string> = {
  primary: "block-btn block-play",
  copper: "block-btn block-copper",
  secondary: "block-btn block-secondary",
  danger: "block-btn block-danger",
  ghost: "rounded-[3px] bg-transparent text-foreground hover:bg-card-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:text-disabled-foreground",
};
const sizes: Record<Size, string> = {
  sm: "h-9 [--px:12px] text-[15px]",
  md: "h-11 [--px:16px] text-[15px]",
  lg: "h-[50px] [--px:22px] text-[15px]",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-semibold disabled:pointer-events-none",
    variant === "ghost" && "px-[var(--px)]",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

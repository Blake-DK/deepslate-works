"use client";
import { useEffect } from "react";

/**
 * The test stripe's height, kept in --stripe-h on <html>, so what sticks to the top of the window and every jump to an
 * anchor stays below the stripe. Measured, because the stripe's words wrap onto two or three lines on a phone.
 */
export function StripeHeight({ of }: { of: string }) {
  useEffect(() => {
    const el = document.getElementById(of);
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--stripe-h", `${el.offsetHeight}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => watch.disconnect();
  }, [of]);
  return null;
}

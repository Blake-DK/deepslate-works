"use client";
import { useEffect } from "react";

/**
 * docs/48 A5: the designer and the builds left Seasons for Admin → Builds. A link to their cards here
 * (`/admin/seasons#design`, `#builds`) carries the card in the part of the address the server never sees, so the page
 * sends it on from the browser.
 */
export function ToBuilds() {
  useEffect(() => {
    if (location.hash === "#design" || location.hash === "#builds") location.replace(`/admin/builds${location.hash}`);
  }, []);
  return null;
}

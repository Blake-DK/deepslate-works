"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** The compact map on the home page. Off by default on weak PCs (it is a 3D view); one click shows it. */
export function MapEmbed({ url, startOpen }: { url: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-dashed bg-card p-4 text-sm text-muted-foreground">
        <span>The map is a 3D view and can be slow on older PCs, so it is hidden here.</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Show map</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <iframe src={url} title="Live map of the world" loading="lazy" className="h-72 w-full rounded-[4px] border bg-panel sm:h-96" referrerPolicy="strict-origin-when-cross-origin" allow="fullscreen" />
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>Hide map</button>
    </div>
  );
}

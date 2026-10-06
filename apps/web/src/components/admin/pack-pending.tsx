"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";

// Admin → Modpack's "out of date" box (Alex, 2026-10-06): whether Lock, Build or Sync server has to be pressed, and
// why. Asks /api/admin/modpack/pending every 20 s while the tab is visible, at once when the tab comes back, and when
// a Lock, Build or Sync on the page finishes (PACK_RAN).

export const PACK_RAN = "deepslate:pack-ran";
const EVERY_MS = 20_000;

type Step = "lock" | "build" | "sync";
type Data = { steps: Step[]; reasons: Array<{ step: Step; text: string }>; headline: string; checkedAt: string };
const LABEL: Record<Step, string> = { lock: "Lock", build: "Build", sync: "Sync server" };

/** `link`: the Control Room's copy, shown only while something has to be pressed, with a link to Modpack. */
export function PackPending({ link = false }: { link?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/modpack/pending", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const id = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener(PACK_RAN, tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener(PACK_RAN, tick);
    };
  }, [load]);

  if (link && !data?.steps.length) return null;
  if (!data) return <Alert tone={failed ? "warn" : "info"} data-testid="pack-pending">{failed ? "Could not check whether a Build or Sync is needed. Trying again…" : "Checking whether a Build or Sync is needed…"}</Alert>;
  const outdated = data.steps.length > 0;
  return (
    <Alert tone={outdated ? "warn" : "success"} data-testid="pack-pending">
      <p className="font-medium">{data.headline}</p>
      {data.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {data.reasons.map((r, i) => (
            <li key={i}>
              <span className="font-medium">{LABEL[r.step]}:</span> {r.text}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Checked {new Date(data.checkedAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London" })}, again every 20 seconds{failed ? " (the last check failed)" : ""}.
        {link && outdated && (
          <>
            {" "}
            <Link href="/admin/pack" className="font-medium underline">Open Modpack</Link>
          </>
        )}
      </p>
    </Alert>
  );
}

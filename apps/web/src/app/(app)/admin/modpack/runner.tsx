"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Cmd = "lock" | "build" | "sync" | "sync-dry";

export function Runner({ canBuild, canSync }: { canBuild: boolean; canSync: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const router = useRouter();

  async function run(cmd: Cmd) {
    setBusy(cmd);
    setLines([]);
    try {
      const res = await fetch(`/api/admin/modpack/${cmd}`, { method: "POST" });
      if (!res.ok || !res.body) {
        setLines([`HTTP ${res.status}`]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.replace(/^data: /, "");
          if (line.startsWith("event: ")) continue;
          setLines((l) => [...l, line]);
          queueMicrotask(() => box.current?.scrollTo({ top: box.current.scrollHeight }));
        }
      }
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run("lock")} disabled={!!busy}>{busy === "lock" ? "Locking…" : "Lock"}</Button>
        <Button onClick={() => run("build")} disabled={!!busy || !canBuild} variant="secondary">{busy === "build" ? "Building…" : "Build"}</Button>
        <Button onClick={() => run("sync-dry")} disabled={!!busy || !canSync} variant="secondary">{busy === "sync-dry" ? "Checking…" : "Sync (dry run)"}</Button>
        <Button onClick={() => run("sync")} disabled={!!busy || !canSync} variant="danger">{busy === "sync" ? "Syncing…" : "Sync server"}</Button>
      </div>
      {lines.length > 0 && <pre ref={box} className="max-h-80 overflow-auto rounded-[4px] border bg-panel p-3 text-xs leading-relaxed">{lines.join("\n")}</pre>}
    </div>
  );
}

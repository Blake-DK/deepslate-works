import { loadCurrentUser } from "@/server/auth/session";
import { readFilter } from "@/lib/event-query";
import { eventsAfter } from "@/server/event-log";
import { KIND_LABEL, SEVERITY } from "@/shared/events";

export const dynamic = "force-dynamic";
export const maxDuration = 660;

const TONE = { info: "neutral", player: "good", warning: "warn", error: "bad", admin: "neutral" } as const;

// Live tail of the event log (docs/16 §4) as text/event-stream. Admins may ask for the full log with
// ?scope=admin; everyone else, and admins without it, get the trimmed kinds and never `raw` or `meta`.
export async function GET(req: Request) {
  const user = await loadCurrentUser();
  if (!user?.pcTier) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  const url = new URL(req.url);
  const admin = user.role === "ADMIN" && url.searchParams.get("scope") === "admin";
  const q: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) q[k] = url.searchParams.getAll(k);
  const filter = readFilter(q, admin);
  let after = BigInt(/^\d{1,18}$/.test(req.headers.get("last-event-id") ?? "") ? req.headers.get("last-event-id")! : /^\d{1,18}$/.test(url.searchParams.get("after") ?? "") ? url.searchParams.get("after")! : "0");
  const enc = new TextEncoder();
  const deadline = Date.now() + 10 * 60_000;
  let closed = false;
  req.signal.addEventListener("abort", () => (closed = true));
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      send("retry: 3000\n\n");
      let quiet = 0;
      while (!closed && Date.now() < deadline) {
        try {
          const rows = await eventsAfter(after, filter, admin);
          for (const e of rows) {
            after = BigInt(e.id);
            send(`id: ${e.id}\ndata: ${JSON.stringify({ id: e.id, at: e.at.toISOString(), kind: e.kind, label: KIND_LABEL[e.kind], tone: TONE[SEVERITY[e.kind]], message: e.message, count: e.count })}\n\n`);
          }
          quiet = rows.length ? 0 : quiet + 1;
          if (quiet % 8 === 7) send(": still here\n\n");
        } catch {
          send(": database not reachable\n\n");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      try {
        controller.close();
      } catch {}
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

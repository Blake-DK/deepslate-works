import { auth } from "@/auth";
import { db } from "@/server/db";
import { apiStream } from "@/server/api-client";

export const dynamic = "force-dynamic";
export const maxDuration = 660;

type StreamEvent = { seq: number; at: string; text: string } | { hb: 1; state: number };

// Admin only. Live console as text/event-stream; each event carries its sequence number as the id, so a
// browser that reconnects sends Last-Event-ID and gets only what it missed. Players never reach this.
export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user?.id ? await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } }) : null;
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  const url = new URL(req.url);
  const since = Math.max(0, Number(req.headers.get("last-event-id") ?? url.searchParams.get("since") ?? 0) || 0);
  const enc = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      send("retry: 3000\n\n");
      try {
        for await (const e of apiStream<StreamEvent>(`/console/stream?since=${since}`, { caller: { id: user.id, role: "ADMIN" }, timeoutMs: 11 * 60_000, signal: abort.signal })) {
          if ("hb" in e) send(`event: state\ndata: ${e.state}\n\n`);
          else send(`id: ${e.seq}\ndata: ${e.text.replace(/\r?\n/g, " ")}\n\n`);
        }
      } catch (err) {
        if (!abort.signal.aborted) send(`event: problem\ndata: ${(err instanceof Error ? err.message : "stream ended").replace(/\r?\n/g, " ")}\n\n`);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

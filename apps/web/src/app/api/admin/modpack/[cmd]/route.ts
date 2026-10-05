import { loadCurrentUser } from "@/server/auth/session";
import { CMDS, runModpack, type Cmd } from "@/server/modpack/run";
import { audit } from "@/server/events";
import { fromAnotherSite } from "@/server/same-origin";

export const maxDuration = 600;

// Admin only. Streams log lines as text/event-stream (docs/08). Same origin, so a page on another site cannot
// start a build with an admin's cookie (docs/35 R-16).
export async function POST(req: Request, { params }: { params: Promise<{ cmd: string }> }) {
  const { cmd } = await params;
  const user = await loadCurrentUser(); // checks the session is still good (docs/04 "Ending sessions")
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  if (fromAnotherSite(req)) return Response.json({ error: { code: "forbidden", message: "same-site only" } }, { status: 403 });
  if (!CMDS.includes(cmd as Cmd)) return Response.json({ error: { code: "validation", message: "unknown command" } }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let failed = false;
      const send = (line: string) => controller.enqueue(enc.encode(`data: ${line.replace(/\n/g, " ")}\n\n`));
      send(`> modpack ${cmd}`);
      for await (const line of runModpack(cmd as Cmd, user)) {
        if (line.startsWith("ERROR") || line.startsWith("busy")) failed = true;
        send(line);
      }
      await audit({ userId: user.id, action: `modpack.${cmd}`, params: {}, result: failed ? "FAILED" : "OK" });
      send(failed ? "event: failed" : "event: done");
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } });
}

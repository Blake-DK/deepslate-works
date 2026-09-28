import { auth } from "@/auth";
import { db } from "@/server/db";
import { CMDS, runModpack, type Cmd } from "@/server/modpack/run";

export const maxDuration = 600;

// Admin only. Streams log lines as text/event-stream (docs/08).
export async function POST(_req: Request, { params }: { params: Promise<{ cmd: string }> }) {
  const { cmd } = await params;
  const session = await auth();
  const user = session?.user?.id ? await db.user.findUnique({ where: { id: session.user.id } }) : null;
  if (!user || user.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
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
      await db.auditLog.create({ data: { userId: user.id, action: `modpack.${cmd}`, params: {}, result: failed ? "FAILED" : "OK" } });
      send(failed ? "event: failed" : "event: done");
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } });
}

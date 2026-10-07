import { loadCurrentUser } from "@/server/auth/session";
import { currentJob } from "@/server/design-jobs";
import { isDesignerOwner } from "@/server/designer";

export const dynamic = "force-dynamic";

// docs/40 Part 2: how far the design job has got, for the card to ask every few seconds while one runs. Owner only;
// it reads and changes nothing but a dead job's file (written down as failed).
export async function GET() {
  const user = await loadCurrentUser();
  if (!user || !isDesignerOwner(user)) return Response.json({ error: { code: "forbidden", message: "the designer's owner only" } }, { status: 403 });
  return Response.json({ job: await currentJob() }, { headers: { "cache-control": "no-store" } });
}

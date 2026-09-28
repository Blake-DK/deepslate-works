import { auth } from "@/auth";

// Caddy forward_auth target for the BlueMap host: 200 with a session, 401 without. No body.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  return new Response(null, { status: 200, headers: { "X-User": session.user.id } });
}

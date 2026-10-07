import { verifyMember } from "@/server/auth/verify";

// Caddy forward_auth target for the BlueMap host: 200 with a session, 401 without. No body.
export async function GET() {
  return verifyMember();
}

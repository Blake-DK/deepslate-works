import { verifyAccess } from "@/server/auth/verify";

// Caddy forward_auth target for the test server's site (docs/42 §3): 200 for an admin, 403 for a member, 401 without
// a session. No body. Nobody but an admin of the live site sees even the test site's sign-in page.
export async function GET() {
  return verifyAccess("admin");
}

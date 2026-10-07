import { verifyAccess } from "@/server/auth/verify";

// Caddy forward_auth target for the mc-router dashboard host: 200 for an admin, 403 for a member, 401 without a
// session. No body. The dashboard has no login of its own and shows players' addresses, so admins only.
export async function GET() {
  return verifyAccess("admin");
}

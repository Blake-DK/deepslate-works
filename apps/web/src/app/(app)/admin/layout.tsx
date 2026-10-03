import { requireAdmin } from "@/server/auth/session";

// Everything under /admin: admins only. The pages are in the admin strip under the main one (components/nav-link.tsx
// AdminStrip, put there by AppFrame: it sits outside the page's padding, docs/23 §4). The console lives on
// Admin → Server → Console only (docs/13 §13; the drawer under every admin page is gone).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <div className="space-y-4">{children}</div>;
}

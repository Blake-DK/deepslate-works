import { Suspense } from "react";
import { requireAdmin } from "@/server/auth/session";
import { ConsoleDock } from "@/components/server/console-dock";

// Everything under /admin: admins only. The pages are in the sidebar's "Run the server" group; the console drawer
// sits under each of them (docs/13 §11 layout).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-4">
      {children}
      <Suspense><ConsoleDock /></Suspense>
    </div>
  );
}

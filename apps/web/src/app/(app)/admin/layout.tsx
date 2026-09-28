import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/users", label: "Users" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" aria-label="Admin">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-card">{l.label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

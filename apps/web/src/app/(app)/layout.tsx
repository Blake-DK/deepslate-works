import { requireOnboardedUser } from "@/server/auth/session";

// Everything under this group needs a logged-in, onboarded user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardedUser();
  return <>{children}</>;
}

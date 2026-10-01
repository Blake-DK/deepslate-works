import { requireOnboardedUser } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { earlyBanner } from "@/shared/access";
import { EarlyBanner } from "@/components/early-banner";
import { AdminSignInNotice } from "@/components/admin-signin-notice";

// Everything under this group needs a logged-in, onboarded user.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const early = earlyBanner(user, (await getSettings()).live);
  return <>{early && <EarlyBanner />}{user.role === "ADMIN" && <AdminSignInNotice />}{children}</>;
}

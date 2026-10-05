import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["modpack"],
  serverExternalPackages: ["@prisma/client", "bcryptjs", "@node-rs/argon2"],
  // Admin → Branding uploads pictures of up to 2 MB through a server action; the default limit is 1 MB. A new poll
  // (planner 2026-10-02) may carry a picture of up to 3 MB for each of its 8 options.
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  // A tab that moved (docs/35) is sent on by its old page, not here: see MOVED in admin/{server,pack,site}/page.tsx.
  // docs/13 §11 layout: every address from before the sidebar still works. Temporary (307) on purpose while v6
  // settles: a browser remembers a 308 for good, and would keep going to the new addresses after a rollback.
  async redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    return [
      to("/install", "/help"),
      to("/guide", "/help?tab=guide"),
      to("/rules", "/help?tab=rules"),
      to("/analytics", "/players?tab=stats"),
      to("/vote", "/pack?tab=vote"),
      to("/vote/results", "/pack?tab=results"),
      to("/vote/results/apply", "/admin/pack?tab=apply"),
      to("/events", "/activity"),
      to("/admin/events", "/activity"),
      to("/admin/files", "/admin/server?tab=files"),
      to("/admin/modpack", "/admin/pack"),
      to("/admin/users", "/admin/people"),
      to("/admin/invites", "/admin/people?tab=invites"),
      to("/admin/installs", "/admin/people?tab=installs"),
      to("/admin/settings", "/admin/site"),
      to("/admin/branding", "/admin/site"),
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "mc-heads.net" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
};

export default nextConfig;

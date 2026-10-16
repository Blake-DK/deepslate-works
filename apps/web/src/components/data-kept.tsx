import type { Section } from "@/shared/settings";

/**
 * What the site keeps and for how long, from the live Privacy and "How long things are kept" settings. One list for
 * the Rules tab and the public /privacy page, so the two never say different things.
 */
export function DataKept({ privacy, retention }: { privacy: Section<"privacy">; retention: Section<"retention"> }) {
  return (
    <ul className="list-disc space-y-1 pl-6 text-sm" data-testid="data-kept">
      <li>When you join and leave the server, your deaths and your advancements. Everyone in the group can see these.</li>
      <li>{privacy.chat ? <>What is said in the in-game chat, for {retention.chatDays} days. Only admins can read it back.</> : "In-game chat is not stored."}</li>
      <li>The address you connect from, for {retention.ipDays} days. Only admins can see it.{privacy.geo ? " The country it belongs to is shown on the stats page." : ""}</li>
      <li>What you do on this site (voting, linking your account), for {retention.eventDays} days.</li>
      <li>When you run the installer: how it went, its log, and what PC it ran on (Windows version, processor, memory, graphics card, free disk space), for {retention.installDays} days. Only admins can see it; you see your own last result on your page. It never includes your Windows user name, and the installer says so before it sends.</li>
    </ul>
  );
}

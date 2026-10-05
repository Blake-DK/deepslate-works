// The words of the "not live yet" banner. Pure, so it is tested (the banner itself is components/launch-banner).
import { formatDate } from "@/lib/utils";
import { ukDay } from "@/shared/season";

export function launchText(launchAt: Date | null, now = new Date()): string {
  if (!launchAt) return "Launch date to be announced.";
  // docs/35 R-22: days of the UK's calendar, not blocks of 24 hours: 19:00 today is "today" at 10:00.
  const days = ukDay(launchAt) - ukDay(now);
  const when = formatDate(launchAt);
  if (launchAt.getTime() > now.getTime()) {
    if (days > 1) return `Launching ${when}, in ${days} days.`;
    if (days === 1) return `Launching ${when}, tomorrow.`;
    return `Launching today, ${when}.`;
  }
  return `Launch was planned for ${when}; Alex will flip the switch any moment.`;
}

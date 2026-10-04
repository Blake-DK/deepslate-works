import type { SeasonFile, SeasonState } from "@/shared/season";

// docs/20 §7, docs/34 (W1.11): the guide's "Season" section, written from the current season's file, so it never
// says something the season does not have. Markdown, added under the guide's own text once a season is announced.

export function seasonGuide(s: SeasonFile, state: SeasonState, at: (iso: string) => string): string {
  const lines: string[] = ["## The season", ""];
  lines.push(state === "ended"
    ? `**${s.name}** ended on ${at(s.endsAt)}. Its results are kept on the Season page, under Hall of fame.`
    : `**${s.name}** runs from ${at(s.startsAt)} to ${at(s.endsAt)}, UK time. Everything about it is on the Season page: what is open, who has done what, and the scoreboard.`);
  if (state === "ended") return lines.join("\n");
  lines.push("");
  if (s.bosses.length > 0) {
    const tiers = new Set(s.bosses.map((b) => b.tier)).size;
    lines.push(`- **Bosses.** There ${s.bosses.length === 1 ? "is" : "are"} ${s.bosses.length} on the ladder${tiers > 1 ? `, in ${tiers} tiers, the easy ones first` : ""}. Kill one and it is ticked for you and for everyone within ${s.groupRadius} blocks of you, so go together and stay close at the end.`);
    lines.push("- **Points.** Every boss and trial is worth points. Whoever does one first on the server gets its points twice. A boss also gives you a trophy, once.");
  }
  if (s.trials.length > 0) lines.push(`- **Trials.** Small tasks, ${s.trials.length} this season, one opening at a time. Each is done by yourself and can be done any time after it opens. One you happen to do before it opens still counts.`);
  if (s.goal) lines.push(`- **Together.** One goal for the whole server: ${s.goal.title}. Every tick on a boss counts towards it.`);
  if (s.frontier) {
    lines.push('- **The Frontier.** A second world for this season, with fresh ground to explore and mine out. Take the waystone at spawn named "The Frontier"; the one there named "Home" brings you back.');
    lines.push("- **The Frontier is wiped when the season ends.** Nothing you build or leave there is kept, and land there cannot be claimed. Keep your base in the main world.");
  }
  if (s.finale) lines.push(`- **The finale.** ${s.finale.title}: ${at(s.finale.at)}. Everyone who is there for it gets the tick.`);
  return lines.join("\n");
}

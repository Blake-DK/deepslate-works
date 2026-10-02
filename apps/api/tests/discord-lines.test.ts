import { describe, expect, it } from "vitest";
import {
  advancementText, asPlayer, deathRun, deathText, escapeText, headUrl, isStale, joinText, leaveText, liveText, packText,
  reminderMessage, restartText, ukWhen, voteClosedText, voteMessage, welcomeText, type FeedEvent, type PollView,
} from "../src/discord/lines.js";

import { REAL } from "./fixtures/discord-events.js";

const brand = { name: "Deepslate Works", accent: "#b8652c", avatar: null };

describe("Discord lines (docs/21 §4)", () => {
  it("a death is the game's sentence, as the player with their head", () => {
    expect(deathText(REAL.death)).toBe("was slain by Vindicator");
    const m = asPlayer(brand, "KaneFinch", REAL.death.actor!, deathText(REAL.death));
    expect(m).toMatchObject({ content: "was slain by Vindicator", username: "KaneFinch", avatar_url: headUrl(REAL.death.actor!), flags: 4, allowed_mentions: { parse: [] } });
    expect(m.avatar_url).toBe("https://mc-heads.net/avatar/3d8a51f06c2e4b97a1d458f9c0e2b7a6/64");
    expect(deathRun("was slain by Vindicator", 1)).toBe("was slain by Vindicator · and 1 more time since");
    expect(deathRun("was slain by Vindicator", 3)).toBe("was slain by Vindicator · and 3 more times since");
  });

  it("a death text with @everyone or a Markdown link pings nobody and shows as plain text", () => {
    const e = { ...REAL.death, message: "KaneFinch was slain by Pabulum using [@everyone click](https://evil.example) <@&123>", meta: { name: "KaneFinch" } };
    const text = deathText(e);
    expect(text).not.toContain("@everyone");
    expect(text).toContain("@\u200beveryone");
    expect(text).toContain("\\[");
    expect(text).toContain("\\]\\(https\\://evil.example\\)");
    expect(text).toContain("\\<@\u200b&123\\>");
    const m = asPlayer(brand, "KaneFinch", REAL.death.actor!, text);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(m.flags).toBe(4); // no link previews
  });

  it("a name Discord would not take as a sender is shown in bold under the server's name", () => {
    const m = asPlayer(brand, "discord_fan", REAL.death.actor!, "joined · 1 online");
    expect(m).toMatchObject({ username: "Deepslate Works", content: "**discord\\_fan** joined · 1 online" });
  });

  it("joins, leaves, challenges and advancements", () => {
    expect(joinText(3)).toBe("joined · 3 online");
    expect(leaveText(2)).toBe("left · 2 online");
    expect(advancementText("challenge", "Monster Hunter")).toBe("completed the challenge **Monster Hunter**");
    expect(advancementText(String((REAL.advancement.meta as { how: string }).how), "Monster Hunter")).toBe("made the advancement **Monster Hunter**");
    expect(advancementText("goal", "The End?")).toBe("reached the goal **The End?**");
  });

  it("the server's own lines", () => {
    expect(welcomeText("samoyedx")).toBe("**samoyedx** is in. Welcome!");
    expect(liveText("Deepslate Works", "deepslate.dsw.test")).toBe("**Deepslate Works is open.** Press Play at deepslate.dsw.test");
    expect(restartText(true)).toBe("The server is restarting for an update. Back in about a minute.");
    expect(packText(3)).toBe("New pack: 3 mods changed. The app updates it when you press Play.");
    expect(packText(1)).toBe("New pack: 1 mod changed. The app updates it when you press Play.");
  });

  it("stale rule: 10 minutes, or 24 hours for votes, news and We're live", () => {
    const after = (e: FeedEvent, min: number) => new Date(e.at.getTime() + min * 60_000);
    expect(isStale(REAL.death, after(REAL.death, 9))).toBe(false);
    expect(isStale(REAL.death, after(REAL.death, 11))).toBe(true);
    expect(isStale(REAL.voteOpen, after(REAL.voteOpen, 11))).toBe(false);
    expect(isStale(REAL.voteOpen, after(REAL.voteOpen, 25 * 60))).toBe(true);
    expect(isStale(REAL.news, after(REAL.news, 23 * 60))).toBe(false);
    expect(isStale(REAL.restart, after(REAL.restart, 11))).toBe(true);
  });

  it("escapes Markdown, mentions and new lines", () => {
    expect(escapeText("*a*_b_~c~`d`|e|")).toBe("\\*a\\*\\_b\\_\\~c\\~\\`d\\`\\|e\\|");
    expect(escapeText("@here\nhi")).toBe("@\u200bhere hi");
  });
});

describe("Discord votes (docs/21 §5)", () => {
  const open: PollView = { kind: "poll", id: "p1", title: "Next boss", options: ["The Harbinger", "Ignis"], closesAt: new Date("2026-10-09T19:00:00Z"), mustVote: true, voters: 0, members: 6, status: "OPEN" };

  it("opened: options, closing time in the UK, must-vote, link, and the count only", () => {
    expect(ukWhen(open.closesAt!)).toBe("Friday 9 Oct, 20:00 UK");
    const m = voteMessage(brand, open, "https://deepslate.dsw.test");
    const e = m.embeds![0]!;
    expect(e.title).toBe("Next boss");
    expect(e.description).toContain("• The Harbinger\n• Ignis");
    expect(e.description).toContain("Closes Friday 9 Oct, 20:00 UK");
    expect(e.description).toContain("You need to vote before you can play");
    expect(e.description).toContain("[Vote](https://deepslate.dsw.test/votes)");
    expect(e.footer?.text).toBe("0 of 6 have voted");
    expect(e.color).toBe(0xb8652c);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    const later = voteMessage(brand, { ...open, voters: 3 }, "https://deepslate.dsw.test").embeds![0]!;
    expect(later.footer?.text).toBe("3 of 6 have voted");
    expect(later.description).toBe(e.description); // never who voted or for what
  });

  it("closed: bars, the winner in bold, I don't mind last, and a new line for the channel", () => {
    const closed: PollView = { ...open, status: "CLOSED", voters: 6, result: [{ text: "The Harbinger", votes: 4 }, { text: "Ignis", votes: 1 }, { text: "I don't mind", votes: 1 }], winners: ["The Harbinger"] };
    const d = voteMessage(brand, closed, "https://deepslate.dsw.test").embeds![0]!.description!;
    expect(d.split("\n")).toEqual(["███████░░░ **The Harbinger · 4**", "██░░░░░░░░ Ignis · 1", "██░░░░░░░░ I don't mind · 1", "", "Closed"]);
    expect(voteClosedText(closed, "https://deepslate.dsw.test")).toBe("**The vote is closed: Next boss** · The Harbinger won with 4 of 6");
    const tie = { ...closed, result: [{ text: "The Harbinger", votes: 3 }, { text: "Ignis", votes: 3 }, { text: "I don't mind", votes: 0 }], winners: ["The Harbinger", "Ignis"] };
    expect(voteClosedText(tie, "https://deepslate.dsw.test")).toBe("**The vote is closed: Next boss** · a tie between The Harbinger and Ignis, 3 each");
  });

  it("the mod ballot", () => {
    const b: PollView = { kind: "ballot", id: "v1", title: "Season 1 mods", options: [], closesAt: null, mustVote: false, voters: 5, members: 6, status: "CLOSED", modsIn: 9 };
    expect(voteClosedText(b, "https://deepslate.dsw.test")).toBe("**Season 1 mods is closed** · 9 mods are in. https://deepslate.dsw.test/pack");
    const o = voteMessage(brand, { ...b, status: "OPEN" }, "https://deepslate.dsw.test").embeds![0]!;
    expect(o.description).toContain("Open until an admin closes it");
    expect(o.url).toBe("https://deepslate.dsw.test/vote");
  });

  it("the reminder pings exactly the members it names, or nobody", () => {
    const now = new Date("2026-10-08T19:00:00Z");
    const m = reminderMessage(brand, open, { discordIds: ["111111111111111111", "222222222222222222"], others: 1 }, true, now);
    expect(m.content).toBe("The vote **Next boss** closes tomorrow at 20:00. Still to vote: <@111111111111111111> <@222222222222222222> and 1 more");
    expect(m.allowed_mentions).toEqual({ parse: [], users: ["111111111111111111", "222222222222222222"] });
    const quiet = reminderMessage(brand, open, { discordIds: ["111111111111111111", "222222222222222222"], others: 0 }, false, now);
    expect(quiet.content).toBe("The vote **Next boss** closes tomorrow at 20:00. 2 people still to vote.");
    expect(quiet.allowed_mentions).toEqual({ parse: [] });
  });
});

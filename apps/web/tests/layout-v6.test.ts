import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../next.config";
import { pickTab, tabHref } from "@/lib/tabs";
import { enchantLabel, itemHue, itemInitials, itemMod, itemName } from "@/lib/items";

// docs/13 §11 layout: the sidebar, pages with tabs, and every old address still working.

describe("tabs", () => {
  const tabs = [{ key: "people", label: "People" }, { key: "stats", label: "Stats" }] as const;
  it("picks the tab the address asks for, else the first", () => {
    expect(pickTab("stats", tabs)).toBe("stats");
    expect(pickTab(["stats", "people"], tabs)).toBe("stats");
    expect(pickTab(undefined, tabs)).toBe("people");
    expect(pickTab("inventory", tabs)).toBe("people"); // a tab this viewer cannot have falls back
  });
  it("gives the first tab the page's own address", () => {
    expect(tabHref("/players", tabs, "people")).toBe("/players");
    expect(tabHref("/players", tabs, "stats")).toBe("/players?tab=stats");
  });
});

describe("item names", () => {
  it("reads an id the way a player would say it", () => {
    expect(itemName("minecraft:diamond_pickaxe")).toBe("Diamond Pickaxe");
    expect(itemName("sophisticatedbackpacks:iron_backpack")).toBe("Iron Backpack");
    expect(itemMod("create:wrench")).toBe("Create");
    expect(itemMod("somemod:thing")).toBe("Somemod");
    expect(itemInitials("minecraft:diamond_pickaxe")).toBe("DP");
    expect(itemInitials("minecraft:torch")).toBe("TO");
    expect(enchantLabel("minecraft:efficiency", 4)).toBe("Efficiency IV");
    expect(enchantLabel("minecraft:mending", 1)).toBe("Mending");
  });
  it("gives the same item the same colour every time", () => {
    expect(itemHue("create:cogwheel")).toBe(itemHue("create:cogwheel"));
    expect(itemHue("create:cogwheel")).toBeGreaterThanOrEqual(0);
    expect(itemHue("create:cogwheel")).toBeLessThan(360);
  });
});

const APP = join(__dirname, "../src/app");
/** Is there a page for this path? Route groups like (app) do not show in the address. */
function pageFor(path: string): boolean {
  const parts = path.split("?")[0]!.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    const groups = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("("));
    if (rest.length === 0 && existsSync(join(dir, "page.tsx"))) return true;
    if (rest.length > 0 && existsSync(join(dir, rest[0]!)) && walk(join(dir, rest[0]!), rest.slice(1))) return true;
    return groups.some((g) => walk(join(dir, g.name), rest));
  };
  return walk(APP, parts);
}

describe("old addresses", () => {
  it("every one redirects to a page that exists", async () => {
    const list = await nextConfig.redirects!();
    const sources = list.map((r) => r.source);
    for (const old of ["/install", "/guide", "/rules", "/analytics", "/vote", "/vote/results", "/vote/results/apply", "/events", "/admin/events", "/admin/files", "/admin/modpack", "/admin/users", "/admin/invites", "/admin/installs", "/admin/settings", "/admin/branding", "/admin/votes"]) {
      expect(sources).toContain(old);
      expect(pageFor(old)).toBe(false); // nothing is left behind at the old address
    }
    for (const r of list) {
      expect(r.permanent).toBe(false);
      expect([r.destination, pageFor(r.destination)]).toEqual([r.destination, true]);
    }
  });
  it("/mods is the Mods guide again (planner, 2026-10-01), no longer a redirect to /pack", async () => {
    expect((await nextConfig.redirects!()).map((r) => r.source)).not.toContain("/mods");
  });
  it("the pages that stay where they were still exist", () => {
    for (const p of ["/", "/map", "/me", "/players", "/help", "/mods", "/pack", "/activity", "/admin", "/admin/server", "/admin/pack", "/admin/people", "/admin/news", "/admin/site", "/admin/joining", "/admin/builds", "/admin/seasons", "/admin/discord"]) expect([p, pageFor(p)]).toEqual([p, true]);
  });
});

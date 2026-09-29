// docs/18: the player guide. Markdown, like the rules page, with one addition: a part of the text can say which
// mod it is about, `<!-- mod: create -->`, and is left out while that mod is not switched on in mods.json. So the
// guide follows the vote without anybody editing it. Pure, so it is tested.

/** Parts of the portal a piece of the guide can wait for: `<!-- feature: actions -->`. */
export const FEATURES = {
  actions: false, // the buttons on the Me page (spawn, home, unstick): Phase 4, not built yet
} as const;

const TAG = /<!--\s*(mod|feature)\s*:\s*([A-Za-z0-9._,\s-]+?)\s*-->/g;
const COMMENT = /<!--[\s\S]*?-->/g;
const HEADING = /^(#{1,6})\s+\S/;
const ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+\S/;

export type Shown = { mods: ReadonlySet<string>; features?: Readonly<Record<string, boolean>> };

/** The tags on one piece of text, and whether every one of them is met. Several names in a tag: all are needed. */
export function allowed(text: string, shown: Shown): boolean {
  const features: Readonly<Record<string, boolean>> = shown.features ?? FEATURES;
  for (const m of text.matchAll(TAG)) {
    const names = m[2]!.split(",").map((n) => n.trim()).filter(Boolean);
    for (const n of names) if (m[1] === "mod" ? !shown.mods.has(n) : features[n] !== true) return false;
  }
  return true;
}

const clean = (line: string) => line.replace(COMMENT, "").replace(/[ \t]+$/, "");

/**
 * The guide as a reader gets it. A tag on a heading covers its whole section, down to the next heading of the same
 * rank or above. A tag on a list item covers that item; a tag in a paragraph covers that paragraph. Every comment
 * is taken out of what is shown, tags or not.
 */
export function filterGuide(src: string, shown: Shown): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let hidden = 0; // rank of the heading whose section is being left out; 0 = none
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const h = HEADING.exec(line);
    if (h) {
      const rank = h[1]!.length;
      i++;
      if (hidden && rank > hidden) continue;
      hidden = allowed(line, shown) ? 0 : rank;
      if (!hidden) out.push(clean(line));
      continue;
    }
    // one piece: a list item with the lines that continue it, or a paragraph, or a blank line
    let end = i + 1;
    if (line.trim() !== "") {
      const item = ITEM.test(line);
      while (end < lines.length) {
        const next = lines[end]!;
        if (next.trim() === "" || HEADING.test(next) || ITEM.test(next)) break;
        if (item && !/^\s{2,}\S/.test(next)) break;
        end++;
      }
    }
    const piece = lines.slice(i, end);
    i = end;
    if (hidden) continue;
    if (!allowed(piece.join("\n"), shown)) continue;
    for (const l of piece) out.push(clean(l));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text under one heading, without the heading, up to the next heading of the same rank or above. "" if there is none. */
export function section(src: string, title: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const want = title.trim().toLowerCase();
  let rank = 0;
  const out: string[] = [];
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (rank === 0) {
      if (h && clean(h[2]!).trim().toLowerCase() === want) rank = h[1]!.length;
      continue;
    }
    if (h && h[1]!.length <= rank) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** For the sign-in page: the numbered steps of "Getting in" and nothing else. "" when the guide has no such steps. */
export function gettingIn(guide: string): string {
  const steps: string[] = [];
  for (const line of section(guide, "Getting in").split("\n")) {
    const step = /^\s*\d{1,3}[.)]\s+\S/.test(line);
    if (steps.length === 0 && !step) continue; // whatever comes before the list
    if (!step && !/^\s{2,}\S/.test(line)) break; // the list is over
    steps.push(line);
  }
  return steps.join("\n");
}

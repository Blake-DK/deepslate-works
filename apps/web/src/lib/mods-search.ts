// The Mods guide's search (/mods), apart from mods-guide.ts so the search box's browser code carries none of the
// guide's text: a section's title is not sent to a viewer it is not shown to (docs/52).

/** Every word of the query somewhere in the card. An empty query matches everything. */
export function matches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}

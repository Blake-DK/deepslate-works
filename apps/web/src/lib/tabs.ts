// Pages with tabs (docs/13 §11 layout): the tab is in the address, `?tab=<key>`; the first tab is the page itself.

export type Tab<K extends string = string> = { key: K; label: string; count?: number | string | null };

/** The tab the address asks for, or the first. */
export function pickTab<K extends string>(asked: string | string[] | undefined, tabs: readonly Tab<K>[]): K {
  const want = Array.isArray(asked) ? asked[0] : asked;
  return (tabs.find((t) => t.key === want) ?? tabs[0]!).key;
}

/** The tab's own address: the first tab is the page itself, the others `?tab=`. */
export const tabHref = (base: string, tabs: readonly Tab[], key: string) => (key === tabs[0]?.key ? base : `${base}?tab=${key}`);

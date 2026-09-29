// A small, safe subset of Markdown for the rules page: headings, paragraphs, lists, bold, italic, code and
// links. It produces a tree, never HTML, so nothing an admin types can turn into markup.

export type Inline = { t: "text"; v: string } | { t: "bold" | "italic" | "code"; v: string } | { t: "link"; v: string; href: string };
export type Block = { t: "h"; level: 2 | 3 | 4; c: Inline[] } | { t: "p"; c: Inline[] } | { t: "ul" | "ol"; items: Inline[][] } | { t: "hr" };

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s<>"']+$/i.test(h)) return h;
  if (/^\/[^/\\][^\s<>"']*$/.test(h) || h === "/") return h; // a page on this site
  return null;
}

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"')]+)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "bold", v: m[2] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: "italic", v: (m[3] ?? m[4])! });
    else if (m[5] !== undefined) {
      const href = safeHref(m[6]!);
      out.push(href ? { t: "link", v: m[5], href } : { t: "text", v: m[5] });
    } else if (m[7] !== undefined) {
      const url = m[7].replace(/[.,;:!?]+$/, "");
      out.push({ t: "link", v: url, href: url });
      if (url.length < m[7].length) out.push({ t: "text", v: m[7].slice(url.length) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

export function markdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: inline(para.join(" ")) });
    para = [];
    if (list) blocks.push({ t: list.t, items: list.items.map(inline) });
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (line.trim() === "") flush();
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ t: "h", level: (m[1]!.length + 1) as 2 | 3 | 4, c: inline(m[2]!) });
    } else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flush();
      blocks.push({ t: "hr" });
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      if (para.length || list?.t === "ol") flush();
      list = list ?? { t: "ul", items: [] };
      list.items.push(m[1]!);
    } else if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) {
      if (para.length || list?.t === "ul") flush();
      list = list ?? { t: "ol", items: [] };
      list.items.push(m[1]!);
    } else if (list && /^\s{2,}\S/.test(raw)) list.items[list.items.length - 1] += ` ${line.trim()}`;
    else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

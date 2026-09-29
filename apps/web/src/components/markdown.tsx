import { Fragment } from "react";
import Link from "next/link";
import { markdown, type Inline } from "@/lib/markdown";

function Line({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.t === "bold") return <strong key={i}>{p.v}</strong>;
        if (p.t === "italic") return <em key={i}>{p.v}</em>;
        if (p.t === "code") return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{p.v}</code>;
        if (p.t === "link") return p.href.startsWith("/") ? <Link key={i} href={p.href} className="underline">{p.v}</Link> : <a key={i} href={p.href} className="underline" target="_blank" rel="noreferrer noopener">{p.v}</a>;
        return <Fragment key={i}>{p.v}</Fragment>;
      })}
    </>
  );
}

/** Renders the small Markdown subset as elements. No HTML is ever inserted, so the text cannot become markup. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 leading-relaxed">
      {markdown(text).map((b, i) => {
        if (b.t === "h") return b.level === 2 ? <h2 key={i} className="pt-2 text-xl font-semibold"><Line parts={b.c} /></h2> : b.level === 3 ? <h3 key={i} className="pt-1 text-lg font-semibold"><Line parts={b.c} /></h3> : <h4 key={i} className="font-semibold"><Line parts={b.c} /></h4>;
        if (b.t === "hr") return <hr key={i} />;
        if ("items" in b) {
          const items = b.items.map((it, j) => <li key={j}><Line parts={it} /></li>);
          return b.t === "ul" ? <ul key={i} className="list-disc space-y-1 pl-6">{items}</ul> : <ol key={i} className="list-decimal space-y-1 pl-6">{items}</ol>;
        }
        return <p key={i}><Line parts={b.c} /></p>;
      })}
    </div>
  );
}

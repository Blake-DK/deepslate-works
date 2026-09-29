import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "@/lib/svg-sanitize";
import { imageKind } from "@/lib/image-kind";
import { inline, markdown, safeHref } from "@/lib/markdown";

const clean = (svg: string) => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const NASTY = /script|onload|onclick|onerror|javascript|foreignobject|<style|style=|data:|evil\.example|file:|<!doctype|<!entity|iframe|<a\b|<image|<animate|<set\b/i;

describe("sanitizeSvg keeps an ordinary picture", () => {
  it("as it was", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#b8652c"/><stop offset="1" stop-color="#d9823f"/></linearGradient><clipPath id="c"><rect width="24" height="24" rx="4"/></clipPath></defs><g clip-path="url(#c)"><path d="M0 0h24v24H0z" fill="url(#g)"/><circle cx="12" cy="12" r="5" fill="#fff" fill-opacity=".8"/><text x="12" y="20" text-anchor="middle" font-size="4">D &amp; W</text><use href="#g"/></g></svg>';
    const r = clean(svg);
    expect(r.svg).toBe(svg);
    expect(r.dropped).toEqual([]);
  });
  it("adds the namespace when it is missing and closes what was left open", () => {
    expect(clean('<svg viewBox="0 0 1 1"><g><rect width="1" height="1">').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><rect width="1" height="1"></rect></g></svg>');
  });
});

describe("sanitizeSvg removes everything that can do something", () => {
  const cases: Array<[string, string]> = [
    ["script element", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>'],
    ["script with a fake closing tag inside", '<svg><script>var a="</g>";alert(1)</script><rect width="1" height="1"/></svg>'],
    ["nested scripts", "<svg><script><script>alert(1)</script></script><rect width='1' height='1'/></svg>"],
    ["event handlers", '<svg onload="alert(1)"><rect width="1" height="1" onclick="alert(2)" ONERROR=alert(3) /></svg>'],
    ["javascript link", '<svg><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>'],
    ["javascript in an allowed attribute", '<svg><use href="javascript:alert(1)"/><rect width="1" height="1" fill="javascript:alert(1)"/></svg>'],
    ["obfuscated javascript", '<svg><rect width="1" height="1" fill="java&#115;cript&colon;alert(1)" stroke="j a v a s c r i p t:alert(1)"/></svg>'],
    ["foreignObject", '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe></body></foreignObject><rect width="1" height="1"/></svg>'],
    ["style element and attribute", '<svg><style>@import url(https://evil.example/x.css); rect{fill:red}</style><rect width="1" height="1" style="fill:url(https://evil.example)"/></svg>'],
    ["outside files", '<svg><image href="https://evil.example/track.png"/><use href="https://evil.example/x.svg#a"/><rect width="1" height="1" fill="url(https://evil.example/p#a)"/></svg>'],
    ["embedded data", '<svg><image href="data:image/svg+xml;base64,PHN2Zz4="/><rect width="1" height="1" fill="url(data:x)"/></svg>'],
    ["doctype and entities", '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text x="0" y="1">&xxe;</text><rect width="1" height="1"/></svg>'],
    ["animation that rewrites an attribute", '<svg><rect width="1" height="1"><set attributeName="onmouseover" to="alert(1)"/><animate attributeName="href" values="javascript:alert(1)"/></rect></svg>'],
    ["markup after the picture ends", '<svg><rect width="1" height="1"/></svg><script>alert(1)</script><img src=x onerror=alert(1)>'],
    ["comments and CDATA", '<svg><!-- <script>alert(1)</script> --><![CDATA[<script>alert(2)</script>]]><rect width="1" height="1"/></svg>'],
  ];
  for (const [what, svg] of cases) {
    it(what, () => {
      const r = clean(svg);
      expect(r.svg).not.toMatch(NASTY);
      expect(r.svg).not.toContain("alert");
      expect(r.svg).toContain("<rect");
      expect(r.svg.startsWith("<svg")).toBe(true);
      expect(r.svg.endsWith("</svg>")).toBe(true);
    });
  }
  it("turns text into text, whatever it contains", () => {
    const r = clean('<svg><text x="0" y="1">a < b & c > d <b onclick="x()">bold</b> &lt;ok&gt; &bogus; &#65;</text></svg>');
    expect(r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="1">a &lt; b &amp; c &gt; d  &lt;ok&gt; &amp;bogus; &#65;</text></svg>');
  });
  it("escapes quotes in attribute values", () => {
    expect(clean(`<svg><rect width="1" height="1" aria-label='say "hi"'/></svg>`).svg).toContain('aria-label="say &quot;hi&quot;"');
  });
  it("unwraps a link around a drawing instead of losing the drawing", () => {
    const r = clean('<svg><a href="https://evil.example" target="_blank"><rect width="1" height="1"/></a></svg>');
    expect(r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    expect(r.dropped).toEqual(["<a>"]);
  });
  it("says what it removed", () => {
    expect(clean('<svg onload="x()"><script>1</script><rect width="1" height="1" style="fill:red" data-x="1"/></svg>').dropped).toEqual(["<script>", "data-x=", "event handlers", "style attributes"]);
  });
  it("refuses what is not a picture, or has nothing left", () => {
    expect(sanitizeSvg("hello")).toEqual({ ok: false, reason: "That is not an SVG picture." });
    expect(sanitizeSvg("<html><body>hi</body></html>").ok).toBe(false);
    expect(sanitizeSvg('<html><body onload="alert(1)"><svg><rect width="1" height="1"/></svg></body></html>').ok).toBe(false);
    expect(sanitizeSvg("<svg><script>alert(1)</script></svg>").ok).toBe(false);
    expect(sanitizeSvg("<svg></svg>").ok).toBe(false);
  });
});

describe("imageKind", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("goes by the content", () => {
    expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(imageKind(new Uint8Array([...bytes("RIFF"), 1, 2, 3, 4, ...bytes("WEBPVP8 ")]))).toBe("webp");
    expect(imageKind(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(imageKind(bytes('﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<svg viewBox="0 0 1 1"/>'))).toBe("svg");
  });
  it("is not fooled", () => {
    expect(imageKind(bytes("<html><svg></svg></html>"))).toBeNull();
    expect(imageKind(bytes("GIF89a"))).toBeNull();
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // JPEG is not on the list
    expect(imageKind(bytes("MZ\u0000\u0000<svg>"))).toBeNull();
    expect(imageKind(new Uint8Array())).toBeNull();
  });
});

describe("markdown", () => {
  it("reads headings, paragraphs and lists", () => {
    expect(markdown("# Rules\n\nBe kind.\nNo griefing.\n\n- one\n- two\n  continued\n\n1. first\n2) second\n\n---\n")).toEqual([
      { t: "h", level: 2, c: [{ t: "text", v: "Rules" }] },
      { t: "p", c: [{ t: "text", v: "Be kind. No griefing." }] },
      { t: "ul", items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two continued" }]] },
      { t: "ol", items: [[{ t: "text", v: "first" }], [{ t: "text", v: "second" }]] },
      { t: "hr" },
    ]);
  });
  it("reads bold, italic, code and links", () => {
    expect(inline("**No** *really* `/home` see [the wiki](https://example.org/w) or https://discord.gg/abc.")).toEqual([
      { t: "bold", v: "No" }, { t: "text", v: " " }, { t: "italic", v: "really" }, { t: "text", v: " " }, { t: "code", v: "/home" }, { t: "text", v: " see " },
      { t: "link", v: "the wiki", href: "https://example.org/w" }, { t: "text", v: " or " }, { t: "link", v: "https://discord.gg/abc", href: "https://discord.gg/abc" }, { t: "text", v: "." },
    ]);
  });
  it("keeps markup as plain text and refuses links that are not web links", () => {
    expect(markdown('<script>alert(1)</script> <img src=x onerror=alert(1)>')).toEqual([{ t: "p", c: [{ t: "text", v: "<script>alert(1)</script> <img src=x onerror=alert(1)>" }] }]);
    expect(inline("[click](javascript:alert(1))")[0]).toEqual({ t: "text", v: "click" });
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/install")).toBe("/install");
    expect(safeHref("https://discord.gg/abc")).toBe("https://discord.gg/abc");
  });
});

describe("pictures of news items", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
  it("are PNG, JPEG or WebP, by what is in the file", async () => {
    const { photoKind } = await import("@/lib/image-kind");
    expect(photoKind(png)).toBe("png");
    expect(photoKind(jpg)).toBe("jpg");
    expect(photoKind(webp)).toBe("webp");
  });
  it("are never SVG, and never anything that only claims to be a picture", async () => {
    const { photoKind } = await import("@/lib/image-kind");
    expect(photoKind(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(photoKind(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(photoKind(new TextEncoder().encode("not a picture at all"))).toBeNull();
    expect(photoKind(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(photoKind(new Uint8Array([]))).toBeNull();
  });
  it("get a name from what is in them, and only such names are ever read or served", async () => {
    const { photoName, PHOTO_NAME } = await import("@/lib/image-kind");
    const name = photoName("a".repeat(64), "png");
    expect(name).toBe("news-aaaaaaaaaaaaaaaa.png");
    expect(PHOTO_NAME.test(name)).toBe(true);
    for (const bad of ["../../deploy/.env", "news-aaaaaaaaaaaaaaaa.svg", "news-aaaaaaaaaaaaaaaa.png/../x", "logo-aaaaaaaaaaaa.png", "news-AAAAAAAAAAAAAAAA.png", "news-aaaaaaaaaaaaaaaa.png.exe", ""]) expect([bad, PHOTO_NAME.test(bad)]).toEqual([bad, false]);
    expect(() => photoName("not a hash", "png")).toThrow();
  });
});

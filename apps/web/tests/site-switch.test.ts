import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// docs/42 §8: the Live | Test switch on the admin strip. Alex (2026-10-10): the two must not trade places when one is
// chosen. Both sites show Live then Test; only which one is highlighted (and which one is a link) changes.

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/people" }));
// vitest compiles the component's JSX the classic way (React.createElement); Next supplies React itself
Object.assign(globalThis, { React });
const { AdminStrip } = await import("@/components/nav-link");

const render = (other: { label: "Live" | "Test"; url: string }) => renderToStaticMarkup(createElement(AdminStrip, { other }));
const order = (html: string) => [...html.matchAll(/data-testid="site-switch-(?:here|other)"[^>]*>(Live|Test)</g)].map((m) => m[1]);

describe("the Live | Test switch", () => {
  it("is Live then Test on the live site, Live highlighted and Test a link to the same page there", () => {
    const html = render({ label: "Test", url: "https://test.deepslate.dsw.test" });
    expect(order(html)).toEqual(["Live", "Test"]);
    expect(html).toMatch(/aria-current="page" data-testid="site-switch-here">Live</);
    expect(html).toContain('href="https://test.deepslate.dsw.test/admin/people"');
  });

  it("is Live then Test on the test site too, Test highlighted and Live a link", () => {
    const html = render({ label: "Live", url: "https://deepslate.dsw.test" });
    expect(order(html)).toEqual(["Live", "Test"]);
    expect(html).toMatch(/aria-current="page" data-testid="site-switch-here">Test</);
    expect(html).toContain('href="https://deepslate.dsw.test/admin/people"');
  });
});

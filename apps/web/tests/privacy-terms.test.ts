import { describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { parseSection } from "@/shared/settings";

// docs/22a §6: the Discord app's Terms of Service and Privacy Policy URLs are /terms and /privacy, open to anyone.

vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: (req: unknown) => unknown) => handler }),
}));
vi.mock("@/auth.config", () => ({ authConfig: {} }));

const { default: middleware } = await import("@/middleware");
// vitest compiles the component's JSX the classic way (React.createElement); Next supplies React itself
Object.assign(globalThis, { React });
const { DataKept } = await import("@/components/data-kept");
const run = middleware as unknown as (req: NextRequest & { auth: unknown }) => Response;
const visitor = (path: string) => {
  const req = new NextRequest(new URL(path, "https://deepslate.dsw.test")) as NextRequest & { auth: unknown };
  req.auth = null;
  return req;
};

describe("privacy and terms pages", () => {
  it.each(["/privacy", "/terms"])("%s opens without signing in", (path) => {
    expect(run(visitor(path)).status).toBe(200);
  });

  it("only those two addresses, nothing under them", () => {
    expect(run(visitor("/privacy/x")).status).toBe(307);
    expect(run(visitor("/terms-old")).status).toBe(307);
  });
});

describe("what the site keeps", () => {
  const render = (privacy: unknown, retention: unknown) =>
    renderToStaticMarkup(createElement(DataKept, { privacy: parseSection("privacy", privacy), retention: parseSection("retention", retention) }));

  it("says the numbers the settings hold", () => {
    const html = render(undefined, { chatDays: 14, ipDays: 7, eventDays: 60, installDays: 45 });
    expect(html).toContain("in-game chat, for 14 days");
    expect(html).toContain("connect from, for 7 days");
    expect(html).toContain("linking your account), for 60 days");
    expect(html).toContain("free disk space), for 45 days");
  });

  it("follows the privacy switches", () => {
    const html = render({ chat: false, geo: false }, undefined);
    expect(html).toContain("In-game chat is not stored.");
    expect(html).not.toContain("The country it belongs to");
  });
});

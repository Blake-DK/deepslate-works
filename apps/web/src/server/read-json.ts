import "server-only";

// req.json() buffers the whole body, and Next.js puts no limit on a route handler, so one large body could fill the
// container's memory. This reads the body in pieces and gives up past maxBytes; Caddy's request_body limit is the
// outer bound. Use it for every JSON body a route reads. A route answers 413 for `too_large` and 400 for `not_json`.
export type ReadJson = { ok: true; body: unknown } | { ok: false; code: "too_large" | "not_json"; status: 413 | 400 };

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<ReadJson> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { ok: false, code: "too_large", status: 413 };
  if (!req.body) return { ok: true, body: {} };
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, code: "too_large", status: 413 };
    }
    parts.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(parts)).replace(/^﻿/, "");
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, code: "not_json", status: 400 };
  }
}

/** The JSON error a route answers when readJson gave up. */
export function readJsonError(r: Extract<ReadJson, { ok: false }>): Response {
  const message = r.code === "too_large" ? "The request is too large." : "The request is not JSON.";
  return Response.json({ error: { code: r.code, message } }, { status: r.status });
}

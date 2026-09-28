import type { Manifest } from "./schema";

export type LinkResult = { slug: string; kind: "wiki" | "video" | "modrinth"; url: string; ok: boolean; status: number | string };

const UA = process.env.MODRINTH_USER_AGENT ?? "deepslate-works/0.1 (link check)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Modrinth's HTML pages rate-limit crawlers; the API with a proper User-Agent is the supported way. */
async function modrinthOk(slug: string): Promise<number | string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return res.status;
    } catch (e) {
      return e instanceof Error ? e.name : "error";
    }
  }
  return 429;
}

async function head(url: string, attempt = 0): Promise<number | string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(25000), headers: { "user-agent": "Mozilla/5.0 (deepslate-works link check)" } });
    if (res.status === 405 || res.status === 403) {
      const r2 = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (deepslate-works link check)" } });
      return r2.status;
    }
    return res.status;
  } catch (e) {
    // Slow wikis (Mekanism's) sometimes need a second try.
    if (attempt === 0 && e instanceof Error && e.name === "TimeoutError") {
      await sleep(2000);
      return head(url, 1);
    }
    return e instanceof Error ? e.name : "error";
  }
}

/** YouTube answers 200 for deleted videos too; oEmbed is the honest check. 401 = exists but embedding is off (fine, we only link out). */
async function youtubeOk(url: string): Promise<number | string> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
    return res.status;
  } catch (e) {
    return e instanceof Error ? e.name : "error";
  }
}

export async function verifyLinks(m: Manifest, opts: { concurrency?: number; onResult?: (r: LinkResult) => void } = {}): Promise<LinkResult[]> {
  const jobs: Array<() => Promise<LinkResult>> = [];
  for (const mod of m.mods) {
    if (mod.hidden) continue;
    jobs.push(async () => {
      const url = `https://modrinth.com/mod/${mod.slug}`;
      const status = await modrinthOk(mod.slug);
      return { slug: mod.slug, kind: "modrinth", url, ok: status === 200, status };
    });
    jobs.push(async () => {
      const onModrinth = /^https:\/\/modrinth\.com\/mod\/([^/?#]+)/.exec(mod.wiki);
      const status = onModrinth ? await modrinthOk(onModrinth[1]!) : await head(mod.wiki);
      return { slug: mod.slug, kind: "wiki", url: mod.wiki, ok: status === 200, status };
    });
    for (const v of mod.videos) {
      jobs.push(async () => {
        const status = await youtubeOk(v.url);
        return { slug: mod.slug, kind: "video", url: v.url, ok: status === 200 || status === 401, status };
      });
    }
  }
  const results: LinkResult[] = [];
  const n = opts.concurrency ?? 3;
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++]!;
      const r = await job();
      results.push(r);
      opts.onResult?.(r);
    }
  }));
  return results;
}

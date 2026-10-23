/**
 * doc 62 §3.1: a comment line every `everyMs` while a Server-Sent Events response waits on something slow (a build, a
 * sync), so no hop in front of web (the newt, Pangolin's Traefik) sees a silent response and cuts it. Browsers ignore
 * comment lines. The returned function stops it; once the stream is closed, a failed enqueue stops it too.
 */
export function keepAlive(enqueue: (chunk: Uint8Array) => void, everyMs = 15_000): () => void {
  const chunk = new TextEncoder().encode(": ping\n\n");
  const timer = setInterval(() => {
    try { enqueue(chunk); } catch { clearInterval(timer); }
  }, everyMs);
  return () => clearInterval(timer);
}

export function youtubeId(url: string): string | null {
  const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url);
  return m?.[1] ?? null;
}

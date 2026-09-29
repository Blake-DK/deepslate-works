// Deepslate Works runs on Windows only (planner decision, 2026-09-29). This is the one place that decides
// whether a browser is on Windows; everything else gets a single line instead of the installer and Play.
export function isWindows(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? "";
  if (/windows phone|iemobile|xbox/i.test(ua)) return false; // say "Windows" but cannot run the game
  return /\bwindows nt\b|\bwin64\b|\bwin32\b|\bwow64\b/i.test(ua);
}

export const WINDOWS_ONLY = (name: string) => `${name} runs on Windows only.`;

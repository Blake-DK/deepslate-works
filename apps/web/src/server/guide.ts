import "server-only";
import { getSection } from "@/server/site-settings";
import { getManifest } from "@/server/modpack/manifest";
import { DEFAULT_GUIDE } from "@/lib/guide-default";
import { filterGuide, gettingIn } from "@/lib/guide";

/** What is in the editor: the admin's text, or the guide as it ships while nobody has saved one. */
export async function getGuideSource(): Promise<{ text: string; own: boolean }> {
  const own = (await getSection("branding")).guide;
  return own.trim() ? { text: own, own: true } : { text: DEFAULT_GUIDE, own: false };
}

/** docs/18: the guide with the parts about mods that are not switched on left out. */
export async function getGuide(): Promise<string> {
  const [{ text }, m] = await Promise.all([getGuideSource(), getManifest()]);
  return filterGuide(text, { mods: new Set(m.mods.filter((x) => x.enabled).map((x) => x.slug)) });
}

/** The few steps shown on the sign-in page. From the admin's text if it has them, else from the guide as it ships. */
export async function getGettingIn(): Promise<string> {
  const { text } = await getGuideSource();
  const none = { mods: new Set<string>() };
  return gettingIn(filterGuide(text, none)) || gettingIn(filterGuide(DEFAULT_GUIDE, none));
}

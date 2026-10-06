/** The version written in DeepslateWorks.ps1 (`$InstallerVersion = "2.2.0"`), or null. On its own so that the site can
 * read it without build.ts's zip and image code (pending.ts). */
export function installerVersion(ps1: string): string | null {
  return /^\$InstallerVersion\s*=\s*"(\d{1,4}(?:\.\d{1,4}){1,3})"/m.exec(ps1)?.[1] ?? null;
}

import { COMMON_PASSWORDS } from "./common-passwords";

// Admin password sign-in (planner, 2026-10-01): at least 12 characters and not a common password.

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 12;

export function normaliseUsername(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Why a password is refused, in words for the form; null when it is fine. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return "At most 200 characters.";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That is one of the most common passwords. Pick another.";
  if (/^(.)\1+$/.test(password)) return "Not one character over and over.";
  if (username && lower.includes(username.toLowerCase())) return "Don't put your username in it.";
  for (const word of ["deepslate", "minecraft", "password"]) {
    if (lower.replace(/[^a-z]/g, "") === word || lower.replace(/[^a-z]/g, "").startsWith(word) && lower.replace(/[^a-z]/g, "").length <= word.length + 2) return "Too close to a word anyone would guess.";
  }
  return null;
}

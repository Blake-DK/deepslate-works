import { randomInt } from "node:crypto";

// No 0/O/1/I so codes can be read out loud over voice chat.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
export const INVITE_CODE_RE = new RegExp(`^[${ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function normaliseInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type InviteState = "valid" | "used" | "expired" | "unknown";

export function inviteState(
  invite: { usedBy: string | null; expiresAt: Date } | null | undefined,
  now: Date = new Date(),
): InviteState {
  if (!invite) return "unknown";
  if (invite.usedBy) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

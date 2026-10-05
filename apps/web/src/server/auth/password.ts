import "server-only";
import bcrypt from "bcryptjs";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// docs/35 R-41: an email nobody has, or a member without a password, costs the same compare as a wrong password,
// so the time a sign-in takes does not tell whether the email is registered.
let dummy: Promise<string> | null = null;
export async function dummyVerifyPassword(plain: string): Promise<void> {
  await bcrypt.compare(plain, await (dummy ??= bcrypt.hash("not a real password, only spends the time", 12)));
}

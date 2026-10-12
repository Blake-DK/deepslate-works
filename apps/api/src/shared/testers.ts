// SHARED FILE: apps/web/src/shared/ and apps/api/src/shared/ hold identical copies (a test compares them).
// Edit the copy in apps/web, then `cp apps/web/src/shared/*.ts apps/api/src/shared/`.
//
// docs/57, testers: a member who gets the app's Test tab and the test server without being an admin. The live web
// tells the test server's api who they are (POST /test/app/tester); both sides work out the same fingerprint of the
// list, so the live web can see when the test server's copy is not its own (an api-test that has just started, a
// switch change that did not get through) and send the whole list again.

import { createHash } from "node:crypto";
import { z } from "zod";

/** A tester as the test server knows them: the Minecraft account, by UUID as the live site stores it, and its name. */
export type Tester = { uuid: string; name: string };

export const TESTER_UUID = z.string().regex(/^[0-9a-fA-F-]{32,36}$/);
export const TESTER_NAME = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
export const TESTER = z.object({ uuid: TESTER_UUID, name: TESTER_NAME });
/** One switch change, or the whole list. */
export const TESTER_BODY = z.union([TESTER.extend({ on: z.boolean() }), z.object({ testers: z.array(TESTER).max(200) })]);

/** What a tester reads when the switch goes off while they are on the test server. */
export const TESTER_OFF_TEXT = "Your test server access was turned off.";

/** The same fingerprint on both sides for the same testers, in whatever order they come. */
export function testersHash(list: readonly Tester[]): string {
  const lines = list.map((t) => `${t.uuid.toLowerCase()} ${t.name}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

// docs/42 T8: the door on the test server. A fresh test database would hold a tester at the door for Play first, for
// a must-vote poll the test site never had, or for an app older than the newest; none of that is what is being tested
// there. So on the test server those three rules are off until Alex turns one on (Admin → Joining on the test site),
// each on its own. Linking stays on: a tester links once, as a member does. Not read at all on live.

export const DOOR_KEY = "test.door";

export type TestDoor = { playFirst: boolean; mustVote: boolean; newestApp: boolean };
export const TEST_DOOR_DEFAULTS: TestDoor = { playFirst: false, mustVote: false, newestApp: false };

/** What is stored, with each rule off unless it says `true`. */
export function readTestDoor(v: unknown): TestDoor {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { playFirst: o.playFirst === true, mustVote: o.mustVote === true, newestApp: o.newestApp === true };
}

/** The door's inputs as the test server's switches leave them. */
export function testDoorInputs(door: TestDoor, d: { requirePlay: boolean; minInstaller: string; unvoted: number }) {
  return { requirePlay: door.playFirst && d.requirePlay, minInstaller: door.newestApp ? d.minInstaller : "", unvoted: door.mustVote ? d.unvoted : 0 };
}

import { testersHash, type Tester } from "../shared/testers.js";

// docs/57, testers (planner and Alex, 2026-10-12), the test server's half. The live site's Tester switch sends each
// change here (POST /test/app/tester, TEST_APP_TOKEN) and the whole list at every start of this api. A tester on:
// a linked, verified member of the test site's database, so the test door lets them straight in with no link, and on
// the test instance's whitelist. Off: off the whitelist, kicked if on, and the door would hold them again.
//
// The test instance sleeps when empty, so a whitelist command may have nowhere to go. The list is kept (a Setting in
// deepslate_test) and at every start of the test instance the whitelist is made to match it: the testers who are on
// are added, the ones turned off removed. Names this never added, and admins of the test site, are never touched.

export const TESTERS_KEY = "test.testers";

export type TesterEntry = Tester & { on: boolean; at: string };

export type TestersDeps = {
  load: () => Promise<unknown>;
  save: (list: TesterEntry[]) => Promise<void>;
  /** Whether the test site has this Minecraft account as one of its admins: then nothing here touches them. */
  isAdmin: (uuid: string) => Promise<boolean>;
  /** The member row for a tester: linked and verified now, let in by the door without a link or a sign-in. */
  admit: (t: Tester) => Promise<void>;
  /** The row's link cleared, so the door would hold them. */
  hold: (uuid: string) => Promise<void>;
  /** Whether the test instance is up to take a console command, and who is on it now (names). */
  server: () => { up: boolean; players: string[] };
  /** Sends one registry action (actions/run.ts); false when it did not go through. */
  run: (action: "tester.add" | "tester.remove", input: { name: string; kick?: boolean }) => Promise<boolean>;
  log: (o: unknown, m: string) => void;
  now?: () => Date;
};

/** What is stored, with anything that is not a tester entry left out. */
export function readTesters(v: unknown): TesterEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is TesterEntry => Boolean(e) && typeof e === "object" && typeof (e as TesterEntry).uuid === "string" && typeof (e as TesterEntry).name === "string" && typeof (e as TesterEntry).on === "boolean");
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class Testers {
  private list: TesterEntry[] = [];
  /** The live site has sent the whole list since this api started; until then the fingerprint is null, so it does. */
  private whole = false;
  private loaded: Promise<void> | null = null;

  constructor(private readonly d: TestersDeps) {}

  private ready() {
    this.loaded ??= this.d.load().then((v) => { this.list = readTesters(v); }).catch((err) => this.d.log({ err: String(err) }, "testers: could not read the list"));
    return this.loaded;
  }

  /** The testers who are on, as the live site would list them. */
  on(): Tester[] {
    return this.list.filter((t) => t.on).map(({ uuid, name }) => ({ uuid, name }));
  }

  /** The fingerprint of the testers who are on (shared/testers.ts); null until the whole list has come since the start. */
  hash(): string | null {
    return this.whole ? testersHash(this.on()) : null;
  }

  /** One switch change from the live site. */
  async one(t: Tester & { on: boolean }) {
    await this.ready();
    if (t.on) await this.turnOn(t);
    else await this.turnOff(t);
    await this.d.save(this.list);
  }

  /** The whole list from the live site: everyone in it on, everyone this turned on before and not in it off. */
  async all(testers: Tester[]) {
    await this.ready();
    for (const t of testers) await this.turnOn(t);
    for (const t of this.list.filter((e) => e.on && !testers.some((n) => same(n.uuid, e.uuid)))) await this.turnOff(t);
    this.whole = true;
    await this.d.save(this.list);
  }

  /** At every start of the test instance: the whitelist made to match the list. */
  async reconcile() {
    await this.ready();
    let added = 0, removed = 0;
    for (const t of this.list) {
      if (await this.d.isAdmin(t.uuid).catch(() => true)) continue;
      if (await this.d.run(t.on ? "tester.add" : "tester.remove", { name: t.name })) {
        if (t.on) added++;
        else removed++;
      }
    }
    if (this.list.length) this.d.log({ added, removed }, "testers: the whitelist matched to the list at the start");
  }

  private put(t: Tester, on: boolean) {
    const at = (this.d.now?.() ?? new Date()).toISOString();
    const i = this.list.findIndex((e) => same(e.uuid, t.uuid));
    const entry = { uuid: t.uuid, name: t.name, on, at };
    if (i >= 0) this.list[i] = entry;
    else this.list.push(entry);
  }

  private async turnOn(t: Tester) {
    const before = this.list.find((e) => same(e.uuid, t.uuid));
    // the same tester again, as they were: nothing to do (the whole list comes at every start of this api)
    if (before?.on && before.name === t.name) return;
    // renamed on Mojang: the old name's whitelist entry is the same account, so it is not removed
    this.put(t, true);
    if (await this.d.isAdmin(t.uuid).catch(() => true)) return;
    await this.d.admit(t);
    if (this.d.server().up) await this.d.run("tester.add", { name: t.name });
  }

  private async turnOff(t: Tester) {
    const before = this.list.find((e) => same(e.uuid, t.uuid));
    // never added here: not this list's to take away
    if (!before) return;
    const name = before.name;
    this.put({ uuid: before.uuid, name }, false);
    if (await this.d.isAdmin(before.uuid).catch(() => true)) return;
    await this.d.hold(before.uuid);
    const s = this.d.server();
    if (s.up) await this.d.run("tester.remove", { name, kick: s.players.some((p) => same(p, name)) });
  }
}

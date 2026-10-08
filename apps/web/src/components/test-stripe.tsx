import { env } from "@/env";
import { getTestState } from "@/server/test-mode";
import { ukDayTime } from "@/lib/uk-time";

/**
 * docs/42 T1: across the top of every page of the test server's site, so it is never mistaken for the live one. With
 * the test clock set, the time it pretends (UK). Nothing on the live site.
 */
export async function TestStripe() {
  if (!env.TEST_MODE) return null;
  const s = await getTestState();
  return (
    <div role="note" data-testid="test-stripe" className="border-b-2 border-[var(--block-edge)] bg-[repeating-linear-gradient(135deg,var(--warn)_0_14px,var(--well)_14px_28px)] px-3 py-1 text-center">
      <span className="inline-block rounded-[3px] bg-[var(--well)] px-2 py-0.5 text-[13px] font-bold tracking-[0.2em] text-[var(--warn)]">
        TEST · the test server, hidden from players{s?.clock.pretending ? ` · test clock ${ukDayTime(new Date(s.clock.now))}` : ""}
      </span>
    </div>
  );
}

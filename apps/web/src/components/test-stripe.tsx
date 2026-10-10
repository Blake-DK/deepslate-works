import { env } from "@/env";
import { getTestState } from "@/server/test-mode";
import { ukDayTime } from "@/lib/uk-time";
import { StripeHeight } from "@/components/stripe-height";
import { webBuild } from "@/server/versions";

/**
 * docs/42 T1: across the top of every page of the test server's site, so it is never mistaken for the live one. With
 * the test clock set, the time it pretends (UK). Nothing on the live site. It stays at the top of the window however far
 * the page scrolls, above the header (z-[45]: over the full-screen map's z-40, under nothing a page opens; a <dialog>
 * opens in the top layer above it). Its height goes to --stripe-h, which globals.css turns into the page's scroll
 * padding on the test site only. It names the commit its images were built from: the test site follows dev, so that is
 * how to tell whether a push has reached it.
 */
export async function TestStripe() {
  if (!env.TEST_MODE) return null;
  const s = await getTestState();
  const commit = webBuild().commit;
  return (
    <div id="test-stripe" role="note" data-testid="test-stripe" className="sticky top-0 z-[45] border-b-2 border-[var(--block-edge)] bg-[repeating-linear-gradient(135deg,var(--warn)_0_14px,var(--well)_14px_28px)] px-3 py-1 text-center">
      <span className="inline-block rounded-[3px] bg-[var(--well)] px-2 py-0.5 text-[13px] font-bold tracking-[0.2em] text-[var(--warn)]">
        TEST · the test server, hidden from players{commit ? ` · build ${commit.slice(0, 7)}` : ""}{s?.clock.pretending ? ` · test clock ${ukDayTime(new Date(s.clock.now))}` : ""}
      </span>
      <StripeHeight of="test-stripe" />
    </div>
  );
}

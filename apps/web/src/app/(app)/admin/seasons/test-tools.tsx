import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/check";
import { Label, fieldClasses } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { dateToUkLocal, ukDayTime } from "@/lib/uk-time";
import type { TestState } from "@/server/test-mode";
import { testClockAction, testResetAction } from "./test-actions";

/** docs/42 §7: on Admin → Seasons of the test site only. The test clock, its quick buttons, and Reset the season test. */
export function TestTools({ state }: { state: TestState | null }) {
  if (!state) {
    return (
      <Card data-testid="test-tools">
        <CardHeader><CardTitle>Test server tools</CardTitle><CardDescription>The test server&apos;s api does not answer, so the test clock cannot be read. Try again in a moment.</CardDescription></CardHeader>
      </Card>
    );
  }
  const { clock, season } = state;
  const now = new Date(clock.now);
  const quick = season?.quick;
  return (
    <Card data-testid="test-tools">
      <CardHeader>
        <CardTitle>Test server tools</CardTitle>
        <CardDescription>
          Only on the test site. The test clock moves the season&apos;s time (what is open, the week, the days left, the once-a-minute lines); sign-ins, the door and the logs keep the real time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          <p data-testid="test-clock-now">
            {clock.pretending ? <>The test clock says <strong>{ukDayTime(now)}</strong> UK, and runs on from there.</> : <>The real time: {ukDayTime(now)} UK. No test clock is set.</>}
          </p>
          <form action={testClockAction.bind(null, "set")} className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="test-clock-at">Pretend it is (UK time)</Label>
              <input id="test-clock-at" name="at" type="datetime-local" required defaultValue={dateToUkLocal(now)} className={cn("mt-1 h-9 text-sm", fieldClasses)} />
            </div>
            <Button type="submit" size="sm">Set the clock</Button>
            {clock.pretending && <Button type="submit" size="sm" variant="secondary" formAction={testClockAction.bind(null, "clear")} formNoValidate>Back to the real time</Button>}
          </form>
          {quick && (
            <form className="flex flex-wrap gap-2" data-testid="test-clock-quick">
              <Button type="submit" size="sm" variant="secondary" formAction={testClockAction.bind(null, `quick:${quick.opening}`)} title={ukDayTime(new Date(quick.opening))}>To opening night</Button>
              {quick.nextDrop && <Button type="submit" size="sm" variant="secondary" formAction={testClockAction.bind(null, `quick:${quick.nextDrop}`)} title={ukDayTime(new Date(quick.nextDrop))}>To the next drop</Button>}
              {quick.finale && <Button type="submit" size="sm" variant="secondary" formAction={testClockAction.bind(null, `quick:${quick.finale}`)} title={ukDayTime(new Date(quick.finale))}>To five minutes before the finale</Button>}
            </form>
          )}
        </div>
        {season && (
          <form action={testResetAction.bind(null, season.id)} className="space-y-2 border-t pt-4">
            <p className="font-semibold">Reset the season test</p>
            <p className="text-muted-foreground">
              Takes every advancement of {season.name} back from everyone on the server, clears the tags and the score its datapack sets, deletes the season&apos;s row and its ticks on this site, and sets the clock back to the real time. The world, inventories and the datapack stay. Everyone with a tick must be on the server, or the game would give it back.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2"><Check type="checkbox" name="sure" /> Yes, reset {season.name}</label>
              <Button type="submit" size="sm" variant="danger">Reset the season test</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

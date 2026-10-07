"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { STATE_LABEL, TONE, type ServerState } from "@/shared/server-state";
import { ukDayTime } from "@/lib/uk-time";

// docs/42 §8: the test server on the live Control Room, for admins. Asked every 20 s while the tab is seen, from the
// page itself, so nothing else on the page waits for it and a test server that does not answer only greys this card.

type Summary = {
  state: ServerState;
  players: string[];
  address: string | null;
  images: string | null;
  checkout: string | null;
  pack: { site: string | null; server: string | null };
  season: { id: string; name: string; state: "upcoming" | "running" | "ended" | null } | null;
  clock: { pretending: boolean; now: string };
};
type Answer = { off: true } | { off: false; summary: Summary | null; problem?: string };

const SEASON_STATE = { upcoming: "announced", running: "running", ended: "ended" } as const;
const short = (c: string | null) => (c ? c.slice(0, 7) : "?");

export function TestServerCard({ site }: { site: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    const ask = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/admin/test-summary", { cache: "no-store" });
        const a = (await r.json()) as Answer;
        if (!stop) { setAnswer(r.ok ? a : null); setFailed(!r.ok); }
      } catch {
        if (!stop) setFailed(true);
      }
    };
    void ask();
    const id = setInterval(() => void ask(), 20_000);
    const seen = () => void ask();
    document.addEventListener("visibilitychange", seen);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", seen); };
  }, []);

  const s = answer && !answer.off ? answer.summary : null;
  let badge: React.ReactNode;
  if (!answer && !failed) badge = <Badge tone="neutral">Asking…</Badge>;
  else if (answer?.off) badge = <Badge tone="neutral">Off</Badge>;
  else if (!s) badge = <Badge tone="bad">Not answering</Badge>;
  else badge = <Badge tone={TONE[s.state]}>{STATE_LABEL[s.state]}</Badge>;

  return (
    <Card data-testid="test-server-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">Test server {badge}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {answer?.off && <p className="text-muted-foreground">Off: TEST_STACK is not 1 in deploy/.env, so the test site and its api are not running.</p>}
        {!answer?.off && (failed || (answer && !s)) && <p className="text-muted-foreground">The test server&apos;s site does not answer{answer && !answer.off && answer.problem ? ` (${answer.problem})` : ""}. Nothing else here depends on it.</p>}
        {s && (
          <>
            <p>{s.players.length === 0 ? "Nobody on it." : <>On it: <span className="font-mono">{s.players.join(", ")}</span></>}</p>
            <p className="text-muted-foreground">
              Images {short(s.images)}, checkout {short(s.checkout)}{s.images && s.checkout && s.images !== s.checkout ? " (not the same commit)" : ""} · pack {s.pack.site ?? "?"}{s.pack.server && s.pack.server !== s.pack.site ? `, the server has ${s.pack.server}` : ""}
            </p>
            {s.season && <p>{s.season.name} · {s.season.state ? SEASON_STATE[s.season.state] : "not announced"}{s.clock.pretending ? `, test clock ${ukDayTime(new Date(s.clock.now))}` : ""}</p>}
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`${site}/admin`} className={buttonClasses("secondary", "sm")} target="_blank" rel="noreferrer noopener">Open the test site</a>
          {s?.address && (
            <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => void navigator.clipboard.writeText(s.address!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
              {copied ? "Copied" : "Copy the address"}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

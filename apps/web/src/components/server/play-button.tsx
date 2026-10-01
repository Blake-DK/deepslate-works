"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PLAY_LINK, PLAY_WAIT_MS, nothingHappened } from "@/lib/play";
import { JOINABLE, WAKE_TIMEOUT_MS, wakeLine, type ServerState } from "@/shared/server-state";
import type { WakeView } from "@/server/status";

type Props = {
  name: string;
  current: string | null;
  ready: boolean;
  /** Already written out on the server, so that the clock of the browser plays no part. */
  last: { version: string; on: string } | null;
  update: boolean;
  /** docs/14 "Play first": "Ready to join until 10:35", or what to do first. Null when Play is not asked of them. */
  join?: { text: string; ready: boolean } | null;
  /** On /install the steps are on the page already; elsewhere the prompt links to them. */
  stepsHere?: boolean;
  /** docs/13 §12: the server in the site's words, and a wake that is running. */
  server: { state: ServerState; line: string; hint: string };
  wake: WakeView;
  /** False after an uninstall (1.5.2): the download is offered straight away, as the first time. */
  installed?: boolean;
  /** Their copy is older than 1.4.0 and cannot update itself (1.5.3): the button is the new download instead. */
  tooOld?: boolean;
};

const POLL_MS = 3000;

/**
 * docs/05 "Play from the site". A plain link to deepslate://play. After the click the page waits 2.5 s: if it is
 * still in front and never lost focus, nothing on this PC took the link, and the installer download is offered.
 */
export function PlayButton({ name, current, ready, last, update, join = null, stepsHere = false, server, wake: initialWake, installed = true, tooOld = false }: Props) {
  const [wake, setWake] = useState<WakeView>(initialWake);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  // docs/13 §12 B: while a wake runs, ask how it is going every 3 s, for as long as a wake may take.
  const follow = useCallback(() => {
    if (poller.current) return;
    const until = Date.now() + WAKE_TIMEOUT_MS + 30_000;
    poller.current = setInterval(async () => {
      try {
        const r = await fetch("/api/play/wake", { cache: "no-store" });
        const j = (await r.json()) as { wake?: WakeView };
        if (j.wake) setWake(j.wake);
        if (!j.wake || j.wake.phase !== "waking" || Date.now() > until) {
          if (poller.current) clearInterval(poller.current);
          poller.current = null;
        }
      } catch {}
    }, POLL_MS);
  }, []);

  useEffect(() => {
    if (initialWake.phase === "waking") follow();
    return () => { if (poller.current) clearInterval(poller.current); };
  }, [initialWake.phase, follow]);

  /** Pressed while the server sleeps: wake it now, so it boots while the game loads. api decides; one start at most. */
  function wakeIt() {
    if (server.state !== "asleep" && server.state !== "waking") return;
    void fetch("/api/play/wake", { method: "POST", keepalive: true })
      .then((r) => r.json() as Promise<{ wake?: WakeView }>)
      .then((j) => { if (j.wake) setWake(j.wake); follow(); })
      .catch(() => follow());
  }

  const [state, setState] = useState<"idle" | "waiting" | "missing">(installed ? "idle" : "missing");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lostFocus = useRef(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    const blurred = () => { lostFocus.current = true; };
    const hidden = () => { if (document.visibilityState !== "visible") lostFocus.current = true; };
    window.addEventListener("blur", blurred);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      stop();
      window.removeEventListener("blur", blurred);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [stop]);

  function clicked(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ready) { e.preventDefault(); return; }
    wakeIt();
    stop();
    lostFocus.current = false;
    setState("waiting");
    // Firefox answers a link nothing is registered for with an error page in place of this one. There the link
    // is opened in a frame nobody sees, so the page stays. Everywhere else the link is simply followed.
    if (/\bfirefox\//i.test(navigator.userAgent) && frame.current) {
      e.preventDefault();
      try {
        if (frame.current.contentWindow) frame.current.contentWindow.location.href = PLAY_LINK;
      } catch {
        setState("missing"); // older Firefox says so at once
        return;
      }
    }
    timer.current = setTimeout(() => {
      const nothing = nothingHappened({ visible: document.visibilityState === "visible", focused: document.hasFocus(), lostFocus: lostFocus.current });
      setState(nothing ? "missing" : "idle");
    }, PLAY_WAIT_MS);
  }

  return (
    <div className="space-y-3" data-testid="play">
      <div className="flex flex-wrap items-center gap-3">
        {tooOld
          ? <a href="/downloads/installer.zip" onClick={(e) => { if (!ready) e.preventDefault(); }} aria-disabled={!ready} data-testid="play-download" className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")}>Download the new installer</a>
          : <a href={PLAY_LINK} onClick={clicked} aria-disabled={!ready} className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")}>
              {state === "waiting" ? "Starting…" : "Play"}
            </a>}
        <div className="text-sm text-muted-foreground">
          <p>
            {current ? <>{name} <span className="font-mono">{current}</span></> : <>The pack hasn&apos;t been built yet</>}
            {update && <Badge tone="warn" className="ml-2">Update available</Badge>}
          </p>
          {join && <p data-testid="join-window" className={join.ready ? "font-medium text-accent" : "font-medium text-foreground"}>{join.text}</p>}
          <p data-testid="last-launch">{last ? <>Your last launch: <span className="font-mono">{last.version}</span> on {last.on}</> : <>You haven&apos;t launched from this account yet</>}</p>
        </div>
      </div>
      {tooOld && <p className="text-sm font-medium text-foreground" data-testid="play-too-old">Your copy is too old to update itself. Run Setup.bat from this download once; after that Play keeps it up to date.</p>}
      {(() => {
        const line = wakeLine(wake);
        if (!line) return null;
        const tone = wake.phase === "ready" ? "text-accent" : wake.phase === "failed" ? "text-danger" : "text-primary";
        return <p className={`text-sm font-medium ${tone}`} data-testid="wake-line" aria-live="polite">{line}</p>;
      })()}
      {!ready && current && (JOINABLE.has(server.state)
        ? <p className="text-sm text-muted-foreground">Play opens when the pack is ready for you.</p>
        : <p className="text-sm text-muted-foreground" data-testid="play-closed"><span className="font-medium text-foreground">{server.line}.</span> {server.hint}</p>)}
      {update && ready && !tooOld && <p className="text-sm text-muted-foreground">Press Play: it fetches what changed, then opens the launcher.</p>}
      {state === "missing" && (
        <Alert tone="info" data-testid="play-missing">
          <p className="font-medium">{installed ? "Looks like the launcher isn\u2019t set up on this PC" : "Download Deepslate Works"}</p>
          {!installed && <p className="mt-1">It was taken off your PC. To play again, set it up once more:</p>}
          <p className="mt-1">Download, unzip and double-click <span className="font-mono">Setup.bat</span> once. After that, Play works from here and it keeps itself up to date.{!stepsHere && <> The steps are under <Link href="/help" className="underline">Getting started → Getting in</Link>.</>}</p>
          <p className="mt-2 flex flex-wrap items-center gap-3">
            <a href="/downloads/installer.zip" className={buttonClasses("secondary", "sm")}>Download installer</a>
            <span className="text-xs text-muted-foreground">Already installed? If your browser asked whether to open Windows PowerShell, answer yes.</span>
          </p>
        </Alert>
      )}
      <iframe ref={frame} title="" hidden aria-hidden="true" tabIndex={-1} className="hidden" />
    </div>
  );
}

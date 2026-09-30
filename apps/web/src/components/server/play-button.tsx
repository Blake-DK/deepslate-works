"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PLAY_LINK, PLAY_WAIT_MS, nothingHappened } from "@/lib/play";

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
};

/**
 * docs/05 "Play from the site". A plain link to deepslate://play. After the click the page waits 2.5 s: if it is
 * still in front and never lost focus, nothing on this PC took the link, and the installer download is offered.
 */
export function PlayButton({ name, current, ready, last, update, join = null, stepsHere = false }: Props) {
  const [state, setState] = useState<"idle" | "waiting" | "missing">("idle");
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
        <a href={PLAY_LINK} onClick={clicked} aria-disabled={!ready} className={buttonClasses("primary", "lg", ready ? undefined : "pointer-events-none opacity-50")}>
          {state === "waiting" ? "Starting…" : "Play"}
        </a>
        <div className="text-sm text-muted-foreground">
          <p>
            {current ? <>{name} <span className="font-mono">{current}</span></> : <>The pack hasn&apos;t been built yet</>}
            {update && <Badge tone="warn" className="ml-2">Update available</Badge>}
          </p>
          {join && <p data-testid="join-window" className={join.ready ? "font-medium text-accent" : "font-medium text-foreground"}>{join.text}</p>}
          <p data-testid="last-launch">{last ? <>Your last launch: <span className="font-mono">{last.version}</span> on {last.on}</> : <>You haven&apos;t launched from this account yet</>}</p>
        </div>
      </div>
      {!ready && current && <p className="text-sm text-muted-foreground">Play opens when the server is up. It&apos;s off right now, or the site can&apos;t reach it.</p>}
      {update && ready && <p className="text-sm text-muted-foreground">Press Play: it fetches what changed, then opens the launcher.</p>}
      {state === "missing" && (
        <Alert tone="info" data-testid="play-missing">
          <p className="font-medium">Looks like the launcher isn&apos;t set up on this PC</p>
          <p className="mt-1">Download, unzip and double-click <span className="font-mono">Setup.bat</span> once. After that, Play works from here and it keeps itself up to date.{!stepsHere && <> The steps are under <Link href="/help" className="underline">Help → Getting in</Link>.</>}</p>
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

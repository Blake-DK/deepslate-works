"use client";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { distanceWords } from "@/lib/distance";

type Limits = { view: { min: number; max: number }; sim: { min: number; max: number } };
type Act = (formData: FormData) => void | Promise<void>;

/**
 * Admin → Server → Settings: the two sliders. Each says in plain words what its number means while it moves; the
 * form goes to the server action with the choice of when it applies bound to the button (never a button value).
 */
export function DistanceForm({ view, sim, limits, running, allowed, applyNow, applyNext }: { view: number; sim: number; limits: Limits; running: boolean; allowed: boolean; applyNow: Act; applyNext: Act }) {
  const [v, setV] = useState(view);
  const [s, setS] = useState(sim);
  const words = distanceWords(v, s);
  const moved = v !== view || s !== sim;
  return (
    <form className="space-y-4" data-testid="distance-form">
      <div className="space-y-1">
        <label htmlFor="view" className="flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>View distance</span>
          <span className="font-mono" data-testid="view-value">{v} chunks</span>
        </label>
        <input id="view" name="view" type="range" min={limits.view.min} max={limits.view.max} step={1} value={v} onChange={(e) => setV(Number(e.target.value))} disabled={!allowed} className="w-full accent-primary" />
        <p className="text-sm text-muted-foreground">{words.view}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="sim" className="flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>Simulation distance</span>
          <span className="font-mono" data-testid="sim-value">{s} chunks</span>
        </label>
        <input id="sim" name="sim" type="range" min={limits.sim.min} max={limits.sim.max} step={1} value={s} onChange={(e) => setS(Number(e.target.value))} disabled={!allowed} className="w-full accent-primary" />
        <p className="text-sm text-muted-foreground">{words.sim}</p>
      </div>
      {words.note && <p className="text-sm text-primary" data-testid="distance-note">{words.note}</p>}
      <p className="text-xs text-muted-foreground">Higher uses more server CPU and RAM. Create machines only run inside simulation distance.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          formAction={applyNow}
          disabled={!allowed || !moved || !running}
          className={buttonClasses("primary", "sm", !allowed || !moved || !running ? "pointer-events-none opacity-50" : undefined)}
          onClick={(e) => {
            if (!window.confirm("Save and restart the server in 1 minute? Players get a warning in chat.")) e.preventDefault();
          }}
        >
          Apply now (restart with 1 minute warning)
        </button>
        <button type="submit" formAction={applyNext} disabled={!allowed || !moved} className={buttonClasses("secondary", "sm", !allowed || !moved ? "pointer-events-none opacity-50" : undefined)}>
          Apply at next restart
        </button>
      </div>
    </form>
  );
}

"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";

type Shader = "none" | "light" | "full";

const SHADERS: Array<{ value: Shader; title: string; hint: string }> = [
  { value: "none", title: "None", hint: "Iris is there, shaders off. You can still pick one in the game." },
  { value: "light", title: "Light", hint: "MakeUp Ultra Fast: soft shadows and nicer water, made for slower PCs." },
  { value: "full", title: "Full", hint: "Complementary Reimagined: the full look. Needs a proper graphics card." },
];

function Choice({ name, value, checked, onChange, title, hint }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; hint?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", checked ? "border-accent bg-muted" : "border-border")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-1" style={{ accentColor: "var(--accent)" }} />
      <span>
        <span className="font-medium">{title}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Me page: "Visual extras: Off / On", and the shader choice only while extras are on. Saved with one button. */
export function VisualsForm({ action, extras, shader }: { action: (fd: FormData) => Promise<void>; extras: boolean; shader: Shader }) {
  const [on, setOn] = useState(extras);
  const [pick, setPick] = useState<Shader>(shader);
  const changed = on !== extras || (on && pick !== shader);
  return (
    <form action={action} className="space-y-3" data-testid="visuals-form">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Visual extras</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice name="extras" value="off" checked={!on} onChange={() => setOn(false)} title="Off" hint="The pack as everyone has it." />
          <Choice name="extras" value="on" checked={on} onChange={() => setOn(true)} title="On" hint="Shaders support, nicer animations, 3D skins, falling leaves, rain and sound effects." />
        </div>
      </fieldset>
      {on && (
        <fieldset className="space-y-2" data-testid="shader-choice">
          <legend className="mb-1 text-sm font-medium">Shaders</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SHADERS.map((s) => <Choice key={s.value} name="shader" value={s.value} checked={pick === s.value} onChange={() => setPick(s.value)} title={s.title} hint={s.hint} />)}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!changed} className={buttonClasses("primary", "sm")}>Save</button>
        <span className="text-sm text-muted-foreground">Takes effect the next time you press Play.</span>
      </div>
    </form>
  );
}

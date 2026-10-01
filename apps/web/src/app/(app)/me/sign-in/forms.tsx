"use client";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { FormState } from "./actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Field = { name: string; label: string; type?: "text" | "password" | "code"; autoComplete?: string; hint?: string; defaultValue?: string };

/** A small form whose answer (a message, an error, or recovery codes shown this once) appears under it. */
export function StateForm({ action, fields, submit, danger = false, testId }: { action: Action; fields: Field[]; submit: string; danger?: boolean; testId?: string }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="space-y-3" data-testid={testId}>
      {fields.map((f) => (
        <div key={f.name}>
          <Label htmlFor={`${testId}-${f.name}`}>{f.label}</Label>
          <Input
            id={`${testId}-${f.name}`}
            name={f.name}
            type={f.type === "password" ? "password" : "text"}
            inputMode={f.type === "code" ? "numeric" : undefined}
            autoComplete={f.autoComplete ?? (f.type === "code" ? "one-time-code" : undefined)}
            defaultValue={f.defaultValue}
            maxLength={f.type === "code" ? 6 : undefined}
            pattern={f.type === "code" ? "[0-9]{6}" : undefined}
            required
          />
          {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} disabled={pending}>{submit}</Button>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.ok && !state.codes && <Alert tone="success">{state.ok}</Alert>}
      {state.codes && <RecoveryCodes codes={state.codes} note={state.ok} />}
    </form>
  );
}

export function RecoveryCodes({ codes, note }: { codes: string[]; note?: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-accent p-3" data-testid="recovery-codes">
      {note && <p className="text-sm font-medium">{note}</p>}
      <p className="text-sm">Your recovery codes. <strong>They are shown this once.</strong> Keep them somewhere safe (your password manager). Each one works once, in place of a code from the app.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

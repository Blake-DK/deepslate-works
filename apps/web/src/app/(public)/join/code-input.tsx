"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CODE_LENGTH, typedCode } from "@/shared/join-code";

/** The code box on /join: capitals, and the hyphen goes in by itself after the third character (Alex, 2026-09-30). */
export function CodeInput() {
  const [value, setValue] = useState("");
  return (
    <Input
      id="code"
      name="code"
      required
      placeholder="ABC-123"
      autoComplete="one-time-code"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      inputMode="text"
      maxLength={CODE_LENGTH + 1}
      value={value}
      onChange={(e) => {
        const deleting = e.target.value.length < value.length;
        setValue(typedCode(e.target.value, deleting));
      }}
      className="h-12 text-center font-mono text-2xl uppercase tracking-widest"
    />
  );
}

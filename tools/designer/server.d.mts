// Types for tools/designer/server.mjs, for its tests in packages/modpack/tests/designer-server.test.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type RunResult = { text: string; ms: number; usage: Usage } | { error: string };
export type RunInput = { cmd: string; args: string[]; input: string; env: Record<string, string>; cwd?: string; timeoutMs?: number };

export const LIMITS: { ask: number; recipe: number; body: number; output: number; timeoutMs: number };
export const RATE: { hourly: number; daily: number };
export type Limiter = { over(): { limit: "hour" | "day"; count: number } | null; take(): void };
export function callLimiter(opts?: { hourly?: number; daily?: number; now?: () => number }): Limiter;
export function designerArgs(model: string, prompt: string): string[];
export function blockListText(list: unknown): string;
export function systemPrompt(dataDir: string, instructionsFile?: string): Promise<string>;
export function userMessage(r: { name: string; ask: string; recipe: unknown }): string;
export function checkRequest(body: unknown): { error: string } | { name: string; ask: string; recipe: object | null; error?: undefined };
export function runDesigner(input: RunInput): Promise<RunResult>;
export function createHandler(opts: {
  token: string;
  cmd: string;
  model: string;
  dataDir: string;
  credentials: string | null;
  childEnv: Record<string, string>;
  run?: (input: RunInput) => Promise<RunResult>;
  instructionsFile?: string;
  limiter?: Limiter;
}):(req: IncomingMessage, res: ServerResponse) => Promise<void>;

import { env } from "../../config/env.js";

/**
 * Structured JSON to stdout — CloudWatch Logs Insights can query fields out of
 * that directly, which plain string logs make you regex for.
 *
 * ⚠️ This system stores identity documents. Never log an applicant's field
 * values; log ids and counts. Everything here takes an explicit payload so that
 * stays a deliberate choice at each call site.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

type Level = Exclude<keyof typeof LEVELS, "silent">;

const threshold = LEVELS[env.LOG_LEVEL];

function emit(level: Level, event: string, payload: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;

  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...payload,
  });

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, payload?: Record<string, unknown>) => emit("debug", event, payload),
  info: (event: string, payload?: Record<string, unknown>) => emit("info", event, payload),
  warn: (event: string, payload?: Record<string, unknown>) => emit("warn", event, payload),
  error: (event: string, payload?: Record<string, unknown>) => emit("error", event, payload),
};

import { z } from "zod";

/**
 * Configuration is read once, at module load, and the process refuses to start
 * if anything is missing. In Lambda that means a bad deploy fails on the first
 * invocation with a clear message, instead of a 500 somewhere deep in a handler.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AWS_REGION: z.string().min(1).default("ap-southeast-1"),

  TABLE_USERS: z.string().min(1),
  TABLE_APPLICATIONS: z.string().min(1),
  TABLE_VEHICLES: z.string().min(1),
  TABLE_NOTIFICATIONS: z.string().min(1),
  TABLE_RENTALS: z.string().min(1),
  TABLE_RATE_LIMITS: z.string().min(1),

  DOCUMENTS_BUCKET: z.string().min(1),

  /** Comma-separated exact origins. No wildcards — credentials cross origins here. */
  CORS_ORIGINS: z.string().min(1),

  /** Absolute origin of the static site, used in notification links. */
  CONSOLE_BASE_URL: z.string().url(),

  ACCESS_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),

  /*
   * Secrets live in SSM Parameter Store, not in the function's environment, so
   * they can be rotated without a redeploy and never show up in a console
   * screenshot of the Lambda configuration.
   */
  JWT_SECRET_PARAM: z.string().min(1),
  TELEGRAM_BOT_TOKEN_PARAM: z.string().min(1),
  TELEGRAM_CHAT_ID_PARAM: z.string().min(1),
  /** A second group: rental schedule alerts go to the people who prepare cars, not the inbox triagers. */
  TELEGRAM_RENTAL_CHAT_ID_PARAM: z.string().min(1),

  /** Local-only escape hatches; when set they win over SSM. */
  JWT_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_RENTAL_CHAT_ID: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Konfigurasi environment tidak valid:\n${problems}`);
  }

  return parsed.data;
}

export const env: Env = load();

export const corsOrigins: string[] = env.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === "production";

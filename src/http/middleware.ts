import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { DomainError, type DomainErrorCode } from "../domain/shared/errors.js";
import { canManageUsers, type User } from "../domain/user/user.js";
import { container } from "../infrastructure/container.js";
import { logger } from "../infrastructure/logging/logger.js";

export type Actor = Pick<User, "id" | "name" | "email" | "role">;

export type AppEnv = {
  Variables: {
    actor: Actor;
    requestId: string;
  };
};

const STATUS_BY_CODE: Record<DomainErrorCode, ContentfulStatusCode> = {
  validation: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/**
 * The single place a thrown error becomes a response.
 *
 * The envelope is `{ message, errors? }` because that is what the console's
 * `http-client.ts` already parses — see `toFieldErrors` there.
 */
export function errorResponse(context: Context, cause: unknown) {
  if (cause instanceof DomainError) {
    return context.json(
      { message: cause.message, errors: cause.fieldErrors },
      STATUS_BY_CODE[cause.code],
    );
  }

  /*
   * Anything else is a bug. The detail goes to CloudWatch; the caller gets a
   * request id to quote and nothing that describes our internals.
   */
  const requestId = context.get("requestId");
  logger.error("unhandled_error", {
    requestId,
    path: context.req.path,
    method: context.req.method,
    error: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
  });

  return context.json(
    { message: `Server sedang bermasalah. Sebutkan kode ini bila melapor: ${requestId}` },
    500,
  );
}

/** Turns a Zod failure into the same `{ message, errors }` envelope. */
export function parseBody<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join(".");
    if (field && !errors[field]) errors[field] = issue.message;
  }

  throw new DomainError("validation", "Periksa kembali isian Anda.", {
    fieldErrors: Object.keys(errors).length > 0 ? errors : undefined,
  });
}

/** Rejects anything without a valid, unexpired bearer token. */
export const authenticate: MiddlewareHandler<AppEnv> = async (context, next) => {
  const header = context.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return context.json({ message: "Anda belum masuk." }, 401);
  }

  const claims = await container.tokens.verify(token);
  if (!claims) {
    return context.json({ message: "Sesi Anda berakhir. Silakan masuk kembali." }, 401);
  }

  /*
   * The token is only half the answer. An account deactivated or deleted after
   * the token was issued must stop working immediately, so the current record
   * is read on every request rather than trusting the claims alone.
   */
  const user = await container.users.findById(claims.sub);
  if (!user || !user.isActive) {
    return context.json({ message: "Akun ini tidak lagi aktif." }, 401);
  }

  context.set("actor", {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  });

  return next();
};

/** Must run after `authenticate`. */
export const requireOwner: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (!canManageUsers(context.get("actor"))) {
    return context.json({ message: "Hanya Pemilik yang dapat membuka halaman ini." }, 403);
  }
  return next();
};

/**
 * Caller IP, for rate limiting.
 *
 * API Gateway populates `requestContext.http.sourceIp` with the real peer
 * address; `x-forwarded-for` is only trusted as a fallback for local
 * development, since a client can set it freely.
 */
export function clientIp(context: Context): string {
  const event = (context.env as { event?: { requestContext?: { http?: { sourceIp?: string } } } })
    ?.event;

  const sourceIp = event?.requestContext?.http?.sourceIp;
  if (sourceIp) return sourceIp;

  const forwarded = context.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

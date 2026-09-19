/**
 * The only error vocabulary the domain and use-case layers speak.
 *
 * Nothing below `src/http` knows about status codes — the HTTP error handler is
 * the single place that maps these onto a response. That is what keeps the use
 * cases callable from a script, a test, or a queue consumer without dragging a
 * web framework along.
 */
export type DomainErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Per-field messages, keyed by the *form field name the client uses*. */
  readonly fieldErrors?: Record<string, string>;
  /** For `rate_limited` only: how long the caller must wait before retrying. */
  readonly retryAfterSeconds?: number;

  constructor(
    code: DomainErrorCode,
    message: string,
    options: {
      fieldErrors?: Record<string, string>;
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const ValidationError = (
  message: string,
  fieldErrors?: Record<string, string>,
): DomainError => new DomainError("validation", message, fieldErrors ? { fieldErrors } : {});

export const UnauthorizedError = (message = "Kredensial tidak valid."): DomainError =>
  new DomainError("unauthorized", message);

export const ForbiddenError = (message = "Anda tidak berhak melakukan tindakan ini."): DomainError =>
  new DomainError("forbidden", message);

export const NotFoundError = (message = "Data tidak ditemukan."): DomainError =>
  new DomainError("not_found", message);

export const ConflictError = (message: string): DomainError =>
  new DomainError("conflict", message);

/**
 * Names the wait rather than saying "a moment": a renter told to try again
 * "shortly" tries again immediately, which is how they got here.
 */
export const RateLimitedError = (retryAfterSeconds: number): DomainError =>
  new DomainError(
    "rate_limited",
    `Terlalu banyak percobaan. Coba lagi dalam ${describeWait(retryAfterSeconds)}.`,
    { retryAfterSeconds },
  );

/** Whole minutes, rounded up — "0 menit" is never a useful instruction. */
export function describeWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} menit`;
}

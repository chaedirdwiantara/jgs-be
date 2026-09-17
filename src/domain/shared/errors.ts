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

  constructor(
    code: DomainErrorCode,
    message: string,
    options: { fieldErrors?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
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

export const RateLimitedError = (
  message = "Terlalu banyak permintaan. Coba lagi beberapa saat lagi.",
): DomainError => new DomainError("rate_limited", message);

/**
 * Cross-cutting ports. Each one exists so a use case can be exercised in a test
 * without AWS, a real clock, or a random number generator.
 */

export interface Clock {
  /** ISO-8601 in UTC, e.g. `2026-09-17T09:31:00.000Z`. */
  now(): string;
}

export interface IdGenerator {
  /** Collision-resistant, URL-safe, and sortable is *not* required. */
  generate(): string;
}

export type RateLimitDecision = {
  allowed: boolean;
  /**
   * Seconds until the current window closes. When `allowed` is false this is
   * how long the caller has to wait; it is what the `Retry-After` header and
   * the message shown to the renter are built from.
   */
  retryAfterSeconds: number;
};

/**
 * Fixed-window counter shared by every public endpoint.
 *
 * `hit` records one attempt and reports whether the caller is now over budget,
 * so callers never need a separate read. `refund` hands one attempt back — for
 * a request that was turned away before it did whatever the limit exists to
 * cap, so that a renter's own failed tries cannot lock them out.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
  refund(key: string, windowSeconds: number): Promise<void>;
}

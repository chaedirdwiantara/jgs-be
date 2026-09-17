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

/**
 * Fixed-window counter shared by every public endpoint.
 *
 * `hit` records one attempt and reports whether the caller is now over budget,
 * so callers never need a separate read.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean }>;
}

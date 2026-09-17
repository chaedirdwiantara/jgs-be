import type { UserRole } from "../user/user.js";

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  /**
   * Must be constant-time with respect to the stored hash, and must perform one
   * full key derivation **even when `hash` is empty or malformed** — the login
   * use case relies on that to answer "no such account" in the same time as
   * "wrong password".
   */
  verify(plaintext: string, hash: string): Promise<boolean>;
}

export type AccessTokenClaims = {
  /** User id. */
  sub: string;
  email: string;
  name: string;
  role: UserRole;
};

export interface TokenIssuer {
  issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: string }>;
  /** Resolves `null` for anything expired, tampered with, or unparsable. */
  verify(token: string): Promise<AccessTokenClaims | null>;
}

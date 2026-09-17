import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { PasswordHasher } from "../../domain/auth/ports.js";

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt from `node:crypto`, not bcrypt or argon2.
 *
 * Both of those are native addons, which means a build step per architecture
 * and a real chance of a Lambda that only fails at runtime. scrypt is in the
 * standard library, is memory-hard, and is an accepted password hash (OWASP
 * lists these parameters as a minimum).
 */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** Node's default cap is 32 MB, which N=16384 sits right on top of. */
const MAX_MEMORY = 64 * 1024 * 1024;

const FORMAT = "scrypt";

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(plaintext, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEMORY });

    return [
      FORMAT,
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join("$");
  }

  /**
   * Performs a full derivation even when `hash` is empty or malformed, so that
   * "no such account" and "wrong password" cost the same — see the port's
   * contract and `usecases/auth/login.ts`.
   */
  async verify(plaintext: string, hash: string): Promise<boolean> {
    const parsed = parse(hash);
    const salt = parsed?.salt ?? Buffer.alloc(SALT_LENGTH);
    const params = parsed?.params ?? PARAMS;

    const derived = await derive(plaintext, salt, parsed?.key.length ?? KEY_LENGTH, {
      ...params,
      maxmem: MAX_MEMORY,
    });

    if (!parsed) return false;

    return derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
  }
}

type ParsedHash = {
  params: { N: number; r: number; p: number };
  salt: Buffer;
  key: Buffer;
};

function parse(hash: string): ParsedHash | null {
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT) return null;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // A stored hash could otherwise ask for more memory than the process has and
  // turn a failed login into a crash.
  if (N > 1 << 20 || r > 32 || p > 16) return null;

  try {
    const salt = Buffer.from(rawSalt ?? "", "base64url");
    const key = Buffer.from(rawKey ?? "", "base64url");
    if (salt.length === 0 || key.length === 0) return null;
    return { params: { N, r, p }, salt, key };
  } catch {
    return null;
  }
}

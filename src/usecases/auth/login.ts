import type { PasswordHasher, TokenIssuer } from "../../domain/auth/ports.js";
import { UnauthorizedError } from "../../domain/shared/errors.js";
import type { Clock, RateLimiter } from "../../domain/shared/ports.js";
import { normaliseEmail, toPublicUser, type User } from "../../domain/user/user.js";
import type { UserRepository } from "../../domain/user/user-repository.js";

export type LoginCommand = {
  email: string;
  password: string;
  /** Used only to rate-limit; never stored. */
  clientIp: string;
};

export type LoginResult = {
  token: string;
  expiresAt: string;
  user: User;
};

/** Five bad tries per identity per 15 minutes is generous for a typist. */
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;

export function makeLogin(deps: {
  users: UserRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  clock: Clock;
  rateLimiter: RateLimiter;
}) {
  return async function login(command: LoginCommand): Promise<LoginResult> {
    const email = normaliseEmail(command.email);

    /*
     * Limited per email *and* per IP: per-email alone lets one host walk a list
     * of addresses, per-IP alone lets a botnet hammer one account.
     */
    const [byEmail, byIp] = await Promise.all([
      deps.rateLimiter.hit(`login:email:${email}`, MAX_ATTEMPTS, WINDOW_SECONDS),
      deps.rateLimiter.hit(`login:ip:${command.clientIp}`, MAX_ATTEMPTS * 4, WINDOW_SECONDS),
    ]);

    if (!byEmail.allowed || !byIp.allowed) {
      throw UnauthorizedError(
        "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.",
      );
    }

    const user = await deps.users.findByEmail(email);

    /*
     * Still run a verification when the account does not exist, so a missing
     * account and a wrong password take the same time to answer. Without this,
     * response latency alone tells an attacker which emails are registered.
     * `verify` is specified to do one full derivation even for a junk hash.
     */
    if (!user) {
      await deps.hasher.verify(command.password, "");
      throw UnauthorizedError("Email atau kata sandi salah.");
    }

    const matches = await deps.hasher.verify(command.password, user.passwordHash);
    if (!matches) throw UnauthorizedError("Email atau kata sandi salah.");

    if (!user.isActive) {
      throw UnauthorizedError("Akun ini dinonaktifkan. Hubungi pemilik akun.");
    }

    const now = deps.clock.now();
    const { token, expiresAt } = await deps.tokens.issue({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    await deps.users.update(user.id, { lastLoginAt: now });

    return { token, expiresAt, user: { ...toPublicUser(user), lastLoginAt: now } };
  };
}

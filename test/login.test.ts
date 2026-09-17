import { beforeEach, describe, expect, it } from "vitest";

import type { AccessTokenClaims, TokenIssuer } from "../src/domain/auth/ports.js";
import { DomainError } from "../src/domain/shared/errors.js";
import type { Clock, RateLimiter } from "../src/domain/shared/ports.js";
import type { UserRepository } from "../src/domain/user/user-repository.js";
import type { User, UserWithSecret } from "../src/domain/user/user.js";
import { ScryptPasswordHasher } from "../src/infrastructure/crypto/scrypt-password-hasher.js";
import { makeLogin } from "../src/usecases/auth/login.js";

const hasher = new ScryptPasswordHasher();
const clock: Clock = { now: () => "2026-09-17T09:00:00.000Z" };

const tokens: TokenIssuer = {
  issue: async (claims: AccessTokenClaims) => ({
    token: `token-for-${claims.sub}`,
    expiresAt: "2026-09-17T17:00:00.000Z",
  }),
  verify: async () => null,
};

function makeUsers(seed: UserWithSecret[]) {
  const rows = new Map(seed.map((user) => [user.id, { ...user }]));

  const repository: UserRepository = {
    findById: async (id) => rows.get(id) ?? null,
    findByEmail: async (email) =>
      [...rows.values()].find((user) => user.email === email) ?? null,
    list: async () => [...rows.values()] as unknown as User[],
    create: async (user) => void rows.set(user.id, user),
    update: async (id, patch) => {
      const current = rows.get(id);
      if (current) rows.set(id, { ...current, ...patch });
    },
    remove: async (id) => void rows.delete(id),
    listActiveIds: async () =>
      [...rows.values()].filter((user) => user.isActive).map((user) => user.id),
  };

  return { repository, rows };
}

/** Counts hits per key so the "too many attempts" path can be exercised. */
function makeRateLimiter(overrides: Record<string, number> = {}): RateLimiter {
  const hits = new Map<string, number>(Object.entries(overrides));

  return {
    hit: async (key, limit) => {
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      return { allowed: next <= limit };
    },
  };
}

let passwordHash: string;

beforeEach(async () => {
  passwordHash ??= await hasher.hash("kata-sandi-benar-123");
});

function seedUser(overrides: Partial<UserWithSecret> = {}): UserWithSecret {
  return {
    id: "user-1",
    email: "admin@jgs-ev.com",
    name: "Pemilik",
    role: "owner",
    isActive: true,
    passwordHash,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastLoginAt: null,
    ...overrides,
  };
}

function build(seed: UserWithSecret[], rateLimiter = makeRateLimiter()) {
  const users = makeUsers(seed);
  return {
    users,
    login: makeLogin({ users: users.repository, hasher, tokens, clock, rateLimiter }),
  };
}

describe("login", () => {
  it("issues a token and records the sign-in", async () => {
    const { login, users } = build([seedUser()]);

    const result = await login({
      email: "admin@jgs-ev.com",
      password: "kata-sandi-benar-123",
      clientIp: "1.1.1.1",
    });

    expect(result.token).toBe("token-for-user-1");
    expect(result.user.lastLoginAt).toBe("2026-09-17T09:00:00.000Z");
    expect(users.rows.get("user-1")?.lastLoginAt).toBe("2026-09-17T09:00:00.000Z");
  });

  it("does not leak the password hash to the caller", async () => {
    const { login } = build([seedUser()]);

    const result = await login({
      email: "admin@jgs-ev.com",
      password: "kata-sandi-benar-123",
      clientIp: "1.1.1.1",
    });

    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("matches the email case-insensitively", async () => {
    const { login } = build([seedUser()]);

    await expect(
      login({
        email: "  ADMIN@JGS-EV.COM ",
        password: "kata-sandi-benar-123",
        clientIp: "1.1.1.1",
      }),
    ).resolves.toMatchObject({ token: "token-for-user-1" });
  });

  it("gives the same message for a wrong password and an unknown account", async () => {
    const { login } = build([seedUser()]);

    const wrongPassword = await login({
      email: "admin@jgs-ev.com",
      password: "salah",
      clientIp: "1.1.1.1",
    }).catch((cause: DomainError) => cause);

    const unknownAccount = await login({
      email: "tidak-ada@jgs-ev.com",
      password: "salah",
      clientIp: "1.1.1.1",
    }).catch((cause: DomainError) => cause);

    expect((wrongPassword as DomainError).message).toBe(
      (unknownAccount as DomainError).message,
    );
    expect((wrongPassword as DomainError).code).toBe("unauthorized");
  });

  it("refuses a deactivated account that still knows its password", async () => {
    const { login } = build([seedUser({ isActive: false })]);

    await expect(
      login({
        email: "admin@jgs-ev.com",
        password: "kata-sandi-benar-123",
        clientIp: "1.1.1.1",
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("stops accepting attempts once the per-email budget is spent", async () => {
    const { login } = build(
      [seedUser()],
      // Already at the limit before this request.
      makeRateLimiter({ "login:email:admin@jgs-ev.com": 5 }),
    );

    await expect(
      login({
        email: "admin@jgs-ev.com",
        // Correct password: the limiter must win regardless.
        password: "kata-sandi-benar-123",
        clientIp: "1.1.1.1",
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

import { jwtVerify, SignJWT } from "jose";

import { env } from "../../config/env.js";
import { USER_ROLES, type UserRole } from "../../domain/user/user.js";
import type { AccessTokenClaims, TokenIssuer } from "../../domain/auth/ports.js";
import { getParameter } from "../aws/parameters.js";

const ISSUER = "jgs-be";
const AUDIENCE = "jgs-admin-console";

/**
 * HS256 with a shared secret, not RS256.
 *
 * The only party that verifies these tokens is this API, so an asymmetric key
 * pair would add key distribution for no benefit. The secret lives in SSM and
 * is fetched once per warm container.
 */
export class JwtTokenIssuer implements TokenIssuer {
  private secret: Promise<Uint8Array> | null = null;

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_TTL_HOURS * 3_600_000);

    const token = await new SignJWT({
      email: claims.email,
      name: claims.name,
      role: claims.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(await this.key());

    return { token, expiresAt: expiresAt.toISOString() };
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, await this.key(), {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });

      const { sub, email, name, role } = payload;

      // A token whose claims do not match the shape below is treated as no
      // token at all, rather than trusted into the request context.
      if (
        typeof sub !== "string" ||
        typeof email !== "string" ||
        typeof name !== "string" ||
        typeof role !== "string" ||
        !isRole(role)
      ) {
        return null;
      }

      return { sub, email, name, role };
    } catch {
      return null;
    }
  }

  private key(): Promise<Uint8Array> {
    this.secret ??= (async () => {
      const value = env.JWT_SECRET ?? (await getParameter(env.JWT_SECRET_PARAM));
      if (value.length < 32) {
        throw new Error("JWT secret terlalu pendek (minimal 32 karakter).");
      }
      return new TextEncoder().encode(value);
    })();

    return this.secret;
  }
}

function isRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

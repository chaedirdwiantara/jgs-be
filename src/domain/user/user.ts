/**
 * Admin console accounts. There are no customer accounts — the public rental
 * form is anonymous by design.
 */

export const USER_ROLES = ["owner", "staff"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Two roles, because the console only has two genuinely different jobs:
 *
 * - `owner` runs the business account: everything `staff` can do, plus creating,
 *   editing and deactivating other accounts.
 * - `staff` works the inbox: read and triage rental applications, edit the
 *   fleet. Cannot touch accounts — including their own role.
 *
 * Adding a third tier before there is a real third job would be guesswork.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Pemilik",
  staff: "Staf",
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** Deactivated accounts keep their history but can no longer sign in. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

/** `User` plus the secret. Never leaves the repository or a use case. */
export type UserWithSecret = User & { passwordHash: string };

/** Drops the password hash before a user object can reach the HTTP layer. */
export function toPublicUser(user: UserWithSecret): User {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export function canManageUsers(user: Pick<User, "role">): boolean {
  return user.role === "owner";
}

/**
 * Emails are the login identifier, so they are stored and compared lowercased —
 * otherwise `Admin@…` and `admin@…` would be two accounts that look identical.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

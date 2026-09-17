import type { User, UserWithSecret } from "./user.js";

export interface UserRepository {
  findById(id: string): Promise<UserWithSecret | null>;
  /** `email` must already be normalised by the caller. */
  findByEmail(email: string): Promise<UserWithSecret | null>;
  list(): Promise<User[]>;
  /** Rejects with a `conflict` DomainError when the email is taken. */
  create(user: UserWithSecret): Promise<void>;
  /** Partial update; `id` and `createdAt` are never writable. */
  update(id: string, patch: Partial<Omit<UserWithSecret, "id" | "createdAt">>): Promise<void>;
  remove(id: string): Promise<void>;
  /** Ids of every account that should receive console notifications. */
  listActiveIds(): Promise<string[]>;
}

import type { PasswordHasher } from "../../domain/auth/ports.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../domain/shared/errors.js";
import type { Clock, IdGenerator } from "../../domain/shared/ports.js";
import {
  canManageUsers,
  normaliseEmail,
  toPublicUser,
  type User,
  type UserRole,
} from "../../domain/user/user.js";
import type { UserRepository } from "../../domain/user/user-repository.js";

type Deps = {
  users: UserRepository;
  hasher: PasswordHasher;
  clock: Clock;
  ids: IdGenerator;
};

/** The person making the request, as resolved from their access token. */
export type Actor = Pick<User, "id" | "role">;

function assertCanManage(actor: Actor): void {
  if (!canManageUsers(actor)) {
    throw ForbiddenError("Hanya Pemilik yang dapat mengelola pengguna.");
  }
}

export function makeListUsers(deps: Pick<Deps, "users">) {
  return async function listUsers(actor: Actor): Promise<User[]> {
    assertCanManage(actor);
    return deps.users.list();
  };
}

export type CreateUserCommand = {
  email: string;
  name: string;
  role: UserRole;
  password: string;
};

export function makeCreateUser(deps: Deps) {
  return async function createUser(actor: Actor, command: CreateUserCommand): Promise<User> {
    assertCanManage(actor);

    const email = normaliseEmail(command.email);
    if (await deps.users.findByEmail(email)) {
      throw ConflictError("Email ini sudah terdaftar.");
    }

    const now = deps.clock.now();
    const record = {
      id: deps.ids.generate(),
      email,
      name: command.name.trim(),
      role: command.role,
      isActive: true,
      passwordHash: await deps.hasher.hash(command.password),
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };

    await deps.users.create(record);
    return toPublicUser(record);
  };
}

export type UpdateUserCommand = {
  name?: string;
  role?: UserRole;
  isActive?: boolean;
  /** Owner resetting someone else's password. Optional. */
  password?: string;
};

export function makeUpdateUser(deps: Deps) {
  return async function updateUser(
    actor: Actor,
    userId: string,
    command: UpdateUserCommand,
  ): Promise<User> {
    assertCanManage(actor);

    const target = await deps.users.findById(userId);
    if (!target) throw NotFoundError("Pengguna tidak ditemukan.");

    /*
     * Lock-out guards. An owner who demotes or deactivates themselves would
     * need another owner to undo it — and if they are the only owner, nobody
     * can. Cheaper to refuse than to write a recovery procedure.
     */
    const isSelf = target.id === actor.id;
    if (isSelf && command.role && command.role !== target.role) {
      throw ValidationError("Anda tidak dapat mengubah peran akun Anda sendiri.");
    }
    if (isSelf && command.isActive === false) {
      throw ValidationError("Anda tidak dapat menonaktifkan akun Anda sendiri.");
    }

    const losesOwner =
      target.role === "owner" && (command.role === "staff" || command.isActive === false);
    if (losesOwner && (await countActiveOwners(deps.users)) <= 1) {
      throw ValidationError(
        "Ini satu-satunya akun Pemilik yang aktif. Angkat Pemilik lain terlebih dahulu.",
      );
    }

    const patch: Record<string, unknown> = { updatedAt: deps.clock.now() };
    if (command.name !== undefined) patch.name = command.name.trim();
    if (command.role !== undefined) patch.role = command.role;
    if (command.isActive !== undefined) patch.isActive = command.isActive;
    if (command.password !== undefined) {
      patch.passwordHash = await deps.hasher.hash(command.password);
    }

    await deps.users.update(userId, patch);

    const updated = await deps.users.findById(userId);
    if (!updated) throw NotFoundError("Pengguna tidak ditemukan.");
    return toPublicUser(updated);
  };
}

export function makeDeleteUser(deps: Pick<Deps, "users">) {
  return async function deleteUser(actor: Actor, userId: string): Promise<void> {
    assertCanManage(actor);

    if (userId === actor.id) {
      throw ValidationError("Anda tidak dapat menghapus akun Anda sendiri.");
    }

    const target = await deps.users.findById(userId);
    if (!target) throw NotFoundError("Pengguna tidak ditemukan.");

    if (target.role === "owner" && (await countActiveOwners(deps.users)) <= 1) {
      throw ValidationError("Ini satu-satunya akun Pemilik yang aktif.");
    }

    await deps.users.remove(userId);
  };
}

export type ChangePasswordCommand = {
  currentPassword: string;
  newPassword: string;
};

/** Self-service. Any signed-in operator may change their own password. */
export function makeChangeOwnPassword(deps: Pick<Deps, "users" | "hasher" | "clock">) {
  return async function changeOwnPassword(
    actor: Actor,
    command: ChangePasswordCommand,
  ): Promise<void> {
    const user = await deps.users.findById(actor.id);
    if (!user) throw NotFoundError("Pengguna tidak ditemukan.");

    const matches = await deps.hasher.verify(command.currentPassword, user.passwordHash);
    if (!matches) {
      throw ValidationError("Kata sandi saat ini salah.", {
        currentPassword: "Kata sandi saat ini salah.",
      });
    }

    await deps.users.update(user.id, {
      passwordHash: await deps.hasher.hash(command.newPassword),
      updatedAt: deps.clock.now(),
    });
  };
}

async function countActiveOwners(users: UserRepository): Promise<number> {
  const all = await users.list();
  return all.filter((user) => user.role === "owner" && user.isActive).length;
}

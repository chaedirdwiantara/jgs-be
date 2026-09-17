import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { ConflictError } from "../../domain/shared/errors.js";
import { toPublicUser, type User, type UserWithSecret } from "../../domain/user/user.js";
import type { UserRepository } from "../../domain/user/user-repository.js";
import { documents, TABLES } from "./client.js";

export const EMAIL_INDEX = "email-index";

/**
 * There will never be more than a handful of console accounts, so `Scan` is the
 * right tool for `list()` — a GSI to avoid scanning a table this small would
 * cost more to maintain than it saves.
 */
export class DynamoUserRepository implements UserRepository {
  async findById(id: string): Promise<UserWithSecret | null> {
    const result = await documents.send(
      new GetCommand({ TableName: TABLES.users, Key: { id } }),
    );
    return (result.Item as UserWithSecret | undefined) ?? null;
  }

  async findByEmail(email: string): Promise<UserWithSecret | null> {
    const result = await documents.send(
      new QueryCommand({
        TableName: TABLES.users,
        IndexName: EMAIL_INDEX,
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
      }),
    );
    return (result.Items?.[0] as UserWithSecret | undefined) ?? null;
  }

  async list(): Promise<User[]> {
    const result = await documents.send(new ScanCommand({ TableName: TABLES.users }));
    const items = (result.Items ?? []) as UserWithSecret[];

    return items
      .map(toPublicUser)
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }

  async create(user: UserWithSecret): Promise<void> {
    try {
      await documents.send(
        new PutCommand({
          TableName: TABLES.users,
          Item: user,
          ConditionExpression: "attribute_not_exists(id)",
        }),
      );
    } catch (cause) {
      if (isConditionFailure(cause)) throw ConflictError("Pengguna sudah ada.");
      throw cause;
    }
  }

  async update(
    id: string,
    patch: Partial<Omit<UserWithSecret, "id" | "createdAt">>,
  ): Promise<void> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;

    /*
     * Names are aliased because `name` and `role` are reserved words in
     * DynamoDB's expression grammar; aliasing all of them keeps this generic.
     */
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const assignments = entries.map(([key, value], index) => {
      names[`#k${index}`] = key;
      values[`:v${index}`] = value;
      return `#k${index} = :v${index}`;
    });

    await documents.send(
      new UpdateCommand({
        TableName: TABLES.users,
        Key: { id },
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(id)",
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await documents.send(new DeleteCommand({ TableName: TABLES.users, Key: { id } }));
  }

  async listActiveIds(): Promise<string[]> {
    const result = await documents.send(
      new ScanCommand({
        TableName: TABLES.users,
        FilterExpression: "isActive = :active",
        ExpressionAttributeValues: { ":active": true },
        ProjectionExpression: "id",
      }),
    );

    return ((result.Items ?? []) as Array<{ id: string }>).map((item) => item.id);
  }
}

export function isConditionFailure(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name: string }).name === "ConditionalCheckFailedException"
  );
}

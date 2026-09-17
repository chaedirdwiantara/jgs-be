import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { env } from "../../config/env.js";

/**
 * One document client for the whole process, created at module load so the
 * TCP handshake happens during Lambda's init phase (which is billed at a
 * discount and does not count against the request's latency budget).
 */
export const documents = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: env.AWS_REGION }),
  {
    marshallOptions: {
      /** `undefined` means "no attribute", not "attribute set to null". */
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  },
);

export const TABLES = {
  users: env.TABLE_USERS,
  applications: env.TABLE_APPLICATIONS,
  vehicles: env.TABLE_VEHICLES,
  notifications: env.TABLE_NOTIFICATIONS,
  rateLimits: env.TABLE_RATE_LIMITS,
} as const;

/**
 * Cursors are base64 of the raw `LastEvaluatedKey`. Opaque to the client by
 * construction, and there is nothing sensitive in a sort key made of a
 * timestamp and an id.
 */
export function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    // A corrupted cursor restarts from the first page rather than erroring —
    // it is a pagination hint, not data.
    return undefined;
  }
}

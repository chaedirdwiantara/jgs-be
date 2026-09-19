import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { RateLimitDecision, RateLimiter } from "../../domain/shared/ports.js";
import { logger } from "../logging/logger.js";
import { documents, TABLES } from "./client.js";

/**
 * Fixed-window counter backed by DynamoDB's atomic `ADD`.
 *
 * Fixed windows let up to 2× the limit through across a window boundary. That
 * is a known and accepted trade — the alternative (a sliding log) costs a write
 * per request and a query per check, to defend a form that a human fills in
 * once. The limits here are set low enough that 2× is still harmless.
 *
 * Rows expire on their own via the table's TTL attribute, so nothing has to be
 * swept.
 */
export class DynamoRateLimiter implements RateLimiter {
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const { rowId, retryAfterSeconds, expiresAt } = describeWindow(key, windowSeconds);

    try {
      const result = await documents.send(
        new UpdateCommand({
          TableName: TABLES.rateLimits,
          Key: { id: rowId },
          UpdateExpression: "ADD hits :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
          ExpressionAttributeValues: { ":one": 1, ":expiresAt": expiresAt },
          ReturnValues: "UPDATED_NEW",
        }),
      );

      const hits = Number(result.Attributes?.hits ?? 0);
      return { allowed: hits <= limit, retryAfterSeconds };
    } catch (cause) {
      /*
       * Fail open. If the counter table is unavailable, a legitimate renter
       * must still be able to submit their form — availability of the actual
       * service matters more than the abuse ceiling, which other layers
       * (API Gateway throttling) also enforce.
       */
      logger.error("rate_limiter_unavailable", { key, error: describe(cause) });
      return { allowed: true, retryAfterSeconds };
    }
  }

  async refund(key: string, windowSeconds: number): Promise<void> {
    const { rowId } = describeWindow(key, windowSeconds);

    try {
      await documents.send(
        new UpdateCommand({
          TableName: TABLES.rateLimits,
          Key: { id: rowId },
          UpdateExpression: "ADD hits :minusOne",
          // Never below zero: a refund for a window that already rolled over
          // (or was never charged) is a no-op, not a credit.
          ConditionExpression: "hits > :zero",
          ExpressionAttributeValues: { ":minusOne": -1, ":zero": 0 },
        }),
      );
    } catch (cause) {
      if (isConditionFailure(cause)) return;
      // Best-effort by contract: worst case the renter is charged for one
      // failed attempt, which the limits are sized to absorb.
      logger.warn("rate_limiter_refund_failed", { key, error: describe(cause) });
    }
  }
}

function describeWindow(key: string, windowSeconds: number) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;

  return {
    rowId: `${key}:${windowStart}`,
    retryAfterSeconds: windowStart + windowSeconds - nowSeconds,
    // A whole extra window of slack, so TTL never deletes a row that is still
    // being counted against.
    expiresAt: windowStart + windowSeconds * 2,
  };
}

function isConditionFailure(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "ConditionalCheckFailedException";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

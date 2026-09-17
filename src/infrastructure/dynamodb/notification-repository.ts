import { BatchWriteCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type { Notification } from "../../domain/notification/notification.js";
import type { NotificationRepository } from "../../domain/notification/notification-repository.js";
import { documents, TABLES } from "./client.js";

export const UNREAD_INDEX = "unread-index";

/**
 * Stored per recipient: partition key is the reader, sort key is
 * `<createdAt>#<id>` so a query comes back in time order without a sort.
 *
 * `unreadSk` mirrors the sort key but is **removed** once the item is read.
 * That makes `unread-index` a sparse index containing only unread items, so the
 * badge count is one `Select: COUNT` query over exactly the rows it counts.
 */
type NotificationItem = Notification & { sk: string; unreadSk?: string };

const sortKey = (notification: Notification) =>
  `${notification.createdAt}#${notification.id}`;

export class DynamoNotificationRepository implements NotificationRepository {
  async listForUser(userId: string, limit: number): Promise<Notification[]> {
    const result = await documents.send(
      new QueryCommand({
        TableName: TABLES.notifications,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );

    return ((result.Items ?? []) as NotificationItem[]).map(
      ({ sk: _sk, unreadSk: _unreadSk, ...notification }) => notification,
    );
  }

  async countUnread(userId: string): Promise<number> {
    const result = await documents.send(
      new QueryCommand({
        TableName: TABLES.notifications,
        IndexName: UNREAD_INDEX,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
        Select: "COUNT",
      }),
    );

    return result.Count ?? 0;
  }

  async createMany(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) return;

    // `BatchWrite` caps at 25 items; the fan-out is one item per console
    // account, so chunking is belt-and-braces rather than a live concern.
    for (const chunk of chunks(notifications, 25)) {
      await documents.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLES.notifications]: chunk.map((notification) => ({
              PutRequest: {
                Item: {
                  ...notification,
                  sk: sortKey(notification),
                  unreadSk: sortKey(notification),
                } satisfies NotificationItem,
              },
            })),
          },
        }),
      );
    }
  }

  async markRead(userId: string, notificationId: string, readAt: string): Promise<void> {
    const item = await this.findByPublicId(userId, notificationId);
    if (!item) return;

    await documents.send(
      new UpdateCommand({
        TableName: TABLES.notifications,
        Key: { userId, sk: item.sk },
        UpdateExpression: "SET readAt = :readAt REMOVE unreadSk",
        ExpressionAttributeValues: { ":readAt": readAt },
      }),
    );
  }

  async markAllRead(userId: string, readAt: string): Promise<void> {
    /*
     * Walks the sparse unread index, so this only touches rows that are
     * actually unread — re-running it costs one empty query.
     */
    let cursor: Record<string, unknown> | undefined;

    do {
      const page = await documents.send(
        new QueryCommand({
          TableName: TABLES.notifications,
          IndexName: UNREAD_INDEX,
          KeyConditionExpression: "userId = :userId",
          ExpressionAttributeValues: { ":userId": userId },
          ProjectionExpression: "userId, sk",
          ExclusiveStartKey: cursor,
        }),
      );

      const items = (page.Items ?? []) as Array<{ userId: string; sk: string }>;

      await Promise.all(
        items.map((item) =>
          documents.send(
            new UpdateCommand({
              TableName: TABLES.notifications,
              Key: { userId: item.userId, sk: item.sk },
              UpdateExpression: "SET readAt = :readAt REMOVE unreadSk",
              ExpressionAttributeValues: { ":readAt": readAt },
            }),
          ),
        ),
      );

      cursor = page.LastEvaluatedKey;
    } while (cursor);
  }

  /**
   * The sort key embeds a timestamp the caller does not have, so a notification
   * is located by its public id. The feed is capped at a few dozen rows per
   * user, which keeps this a bounded query rather than a table walk.
   */
  private async findByPublicId(
    userId: string,
    notificationId: string,
  ): Promise<NotificationItem | null> {
    const result = await documents.send(
      new QueryCommand({
        TableName: TABLES.notifications,
        KeyConditionExpression: "userId = :userId",
        FilterExpression: "id = :id",
        ExpressionAttributeValues: { ":userId": userId, ":id": notificationId },
        ScanIndexForward: false,
        Limit: 200,
      }),
    );

    return (result.Items?.[0] as NotificationItem | undefined) ?? null;
  }
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

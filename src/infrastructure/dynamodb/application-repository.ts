import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type {
  ApplicationPage,
  ApplicationRepository,
  ListApplicationsQuery,
} from "../../domain/application/application-repository.js";
import {
  APPLICATION_STATUSES,
  toSummary,
  type ApplicationStatus,
  type RentalApplication,
} from "../../domain/application/rental-application.js";
import { decodeCursor, documents, encodeCursor, TABLES } from "./client.js";

export const INBOX_INDEX = "inbox-index";
export const STATUS_INDEX = "status-index";

/**
 * Every application carries this constant so the whole inbox lives in one
 * partition of `inbox-index`, sorted by `submittedAt`.
 *
 * A single-partition index is normally an anti-pattern — but the alternative is
 * a table scan plus an in-memory sort on every page, and this business receives
 * single-digit applications a day. Revisit if that ever becomes hundreds an
 * hour; the fix is to shard this on the submission month.
 */
const INBOX_PARTITION = "application";

type ApplicationItem = RentalApplication & { listPk: string };

export class DynamoApplicationRepository implements ApplicationRepository {
  async list(query: ListApplicationsQuery): Promise<ApplicationPage> {
    const usesStatus = query.status !== undefined;

    const result = await documents.send(
      new QueryCommand({
        TableName: TABLES.applications,
        IndexName: usesStatus ? STATUS_INDEX : INBOX_INDEX,
        KeyConditionExpression: usesStatus ? "#status = :pk" : "listPk = :pk",
        ExpressionAttributeNames: usesStatus ? { "#status": "status" } : undefined,
        ExpressionAttributeValues: { ":pk": usesStatus ? query.status : INBOX_PARTITION },
        // Newest first.
        ScanIndexForward: false,
        Limit: query.limit,
        ExclusiveStartKey: decodeCursor(query.cursor),
      }),
    );

    return {
      items: ((result.Items ?? []) as ApplicationItem[]).map(toSummary),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  async findById(id: string): Promise<RentalApplication | null> {
    const result = await documents.send(
      new GetCommand({ TableName: TABLES.applications, Key: { id } }),
    );
    if (!result.Item) return null;

    const { listPk: _listPk, ...application } = result.Item as ApplicationItem;
    return application;
  }

  async create(application: RentalApplication): Promise<void> {
    const item: ApplicationItem = { ...application, listPk: INBOX_PARTITION };

    await documents.send(
      new PutCommand({
        TableName: TABLES.applications,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  }

  async update(
    id: string,
    patch: Partial<Omit<RentalApplication, "id" | "referenceCode" | "submittedAt">>,
  ): Promise<void> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const assignments = entries.map(([key, value], index) => {
      names[`#k${index}`] = key;
      values[`:v${index}`] = value;
      return `#k${index} = :v${index}`;
    });

    await documents.send(
      new UpdateCommand({
        TableName: TABLES.applications,
        Key: { id },
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(id)",
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await documents.send(new DeleteCommand({ TableName: TABLES.applications, Key: { id } }));
  }

  async countByStatus(): Promise<Record<ApplicationStatus, number>> {
    const counts = await Promise.all(
      APPLICATION_STATUSES.map(async (status) => {
        const result = await documents.send(
          new QueryCommand({
            TableName: TABLES.applications,
            IndexName: STATUS_INDEX,
            KeyConditionExpression: "#status = :status",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":status": status },
            Select: "COUNT",
          }),
        );
        return [status, result.Count ?? 0] as const;
      }),
    );

    return Object.fromEntries(counts) as Record<ApplicationStatus, number>;
  }
}

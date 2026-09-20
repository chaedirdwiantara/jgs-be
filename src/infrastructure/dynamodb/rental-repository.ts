import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  MAX_DURATION_DAYS,
  type ReminderLedger,
  type Rental,
} from "../../domain/rental/rental.js";
import type { RentalRepository } from "../../domain/rental/rental-repository.js";
import { addDays } from "../../domain/shared/dates.js";
import { documents, TABLES } from "./client.js";

export const SCHEDULE_INDEX = "schedule-index";
export const END_DATE_INDEX = "end-date-index";
export const PAYMENT_INDEX = "payment-index";

/**
 * Every rental carries this constant so the whole schedule lives in one
 * partition of `schedule-index` (sorted by `startDate`) and of
 * `end-date-index` (sorted by `endDate`). Same trade-off as the application
 * inbox: single-digit rentals a day, so one partition is the simplest thing
 * that works and a shard-by-month is the fix if that ever changes.
 */
const SCHEDULE_PARTITION = "rental";

type RentalItem = Rental & { listPk: string };

function strip(item: RentalItem): Rental {
  const { listPk: _listPk, ...rental } = item;
  return rental;
}

const byStart = (a: Rental, b: Rental) =>
  a.startDate.localeCompare(b.startDate) ||
  a.startTime.localeCompare(b.startTime) ||
  a.createdAt.localeCompare(b.createdAt);

export class DynamoRentalRepository implements RentalRepository {
  async listOverlapping(from: string, to: string): Promise<Rental[]> {
    /*
     * "Overlaps [from, to]" is `startDate <= to AND endDate >= from`. Only the
     * first half is a key condition; the second is a filter. The lower bound
     * on `startDate` is what keeps the query from walking the whole history:
     * nothing that started more than the maximum duration before `from` can
     * still be running on `from`.
     */
    const earliestStart = addDays(from, -(MAX_DURATION_DAYS - 1));

    const items = await this.queryAll({
      IndexName: SCHEDULE_INDEX,
      KeyConditionExpression: "listPk = :pk AND startDate BETWEEN :earliest AND :to",
      FilterExpression: "endDate >= :from",
      ExpressionAttributeValues: {
        ":pk": SCHEDULE_PARTITION,
        ":earliest": earliestStart,
        ":to": to,
        ":from": from,
      },
    });

    return items.sort(byStart);
  }

  async listStartingOn(date: string): Promise<Rental[]> {
    const items = await this.queryAll({
      IndexName: SCHEDULE_INDEX,
      KeyConditionExpression: "listPk = :pk AND startDate = :date",
      ExpressionAttributeValues: { ":pk": SCHEDULE_PARTITION, ":date": date },
    });
    return items.sort(byStart);
  }

  async listEndingOn(date: string): Promise<Rental[]> {
    const items = await this.queryAll({
      IndexName: END_DATE_INDEX,
      KeyConditionExpression: "listPk = :pk AND endDate = :date",
      ExpressionAttributeValues: { ":pk": SCHEDULE_PARTITION, ":date": date },
    });
    return items.sort(byStart);
  }

  async listUnpaidDueBefore(date: string): Promise<Rental[]> {
    const items = await this.queryAll({
      IndexName: PAYMENT_INDEX,
      KeyConditionExpression: "paymentStatus = :status AND paymentDueDate < :date",
      ExpressionAttributeValues: { ":status": "belum_dibayar", ":date": date },
    });
    return items.sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate));
  }

  async findById(id: string): Promise<Rental | null> {
    const result = await documents.send(new GetCommand({ TableName: TABLES.rentals, Key: { id } }));
    return result.Item ? strip(result.Item as RentalItem) : null;
  }

  async create(rental: Rental): Promise<void> {
    const item: RentalItem = { ...rental, listPk: SCHEDULE_PARTITION };
    await documents.send(
      new PutCommand({
        TableName: TABLES.rentals,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  }

  async replace(rental: Rental): Promise<void> {
    const item: RentalItem = { ...rental, listPk: SCHEDULE_PARTITION };
    await documents.send(
      new PutCommand({
        TableName: TABLES.rentals,
        Item: item,
        ConditionExpression: "attribute_exists(id)",
      }),
    );
  }

  async stampReminder(id: string, key: keyof ReminderLedger, sentOn: string): Promise<void> {
    await documents.send(
      new UpdateCommand({
        TableName: TABLES.rentals,
        Key: { id },
        UpdateExpression: "SET reminders.#key = :sentOn",
        ExpressionAttributeNames: { "#key": key },
        ExpressionAttributeValues: { ":sentOn": sentOn },
        ConditionExpression: "attribute_exists(id)",
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await documents.send(new DeleteCommand({ TableName: TABLES.rentals, Key: { id } }));
  }

  /** Follows `LastEvaluatedKey` to the end: a month of rentals is one screen, never a feed. */
  private async queryAll(
    input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">,
  ): Promise<Rental[]> {
    const items: Rental[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await documents.send(
        new QueryCommand({ TableName: TABLES.rentals, ...input, ExclusiveStartKey: exclusiveStartKey }),
      );
      for (const item of (result.Items ?? []) as RentalItem[]) items.push(strip(item));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }
}

import { DeleteCommand, GetCommand, PutCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { ConflictError } from "../../domain/shared/errors.js";
import type { Vehicle } from "../../domain/vehicle/vehicle.js";
import type { VehicleRepository } from "../../domain/vehicle/vehicle-repository.js";
import { documents, TABLES } from "./client.js";
import { isConditionFailure } from "./user-repository.js";

/** A fleet is a dozen rows at most; `Scan` reads the whole catalogue in one call. */
export class DynamoVehicleRepository implements VehicleRepository {
  async list(): Promise<Vehicle[]> {
    const result = await documents.send(new ScanCommand({ TableName: TABLES.vehicles }));
    return ((result.Items ?? []) as Vehicle[]).sort((a, b) => a.dailyRate - b.dailyRate);
  }

  async findById(id: string): Promise<Vehicle | null> {
    const result = await documents.send(
      new GetCommand({ TableName: TABLES.vehicles, Key: { id } }),
    );
    return (result.Item as Vehicle | undefined) ?? null;
  }

  async create(vehicle: Vehicle): Promise<void> {
    try {
      await documents.send(
        new PutCommand({
          TableName: TABLES.vehicles,
          Item: vehicle,
          ConditionExpression: "attribute_not_exists(id)",
        }),
      );
    } catch (cause) {
      if (isConditionFailure(cause)) {
        throw ConflictError(`Kode unit "${vehicle.id}" sudah dipakai.`);
      }
      throw cause;
    }
  }

  async replace(id: string, vehicle: Vehicle): Promise<void> {
    if (vehicle.id === id) {
      await documents.send(new PutCommand({ TableName: TABLES.vehicles, Item: vehicle }));
      return;
    }

    /*
     * The slug is the key, so renaming one is a delete plus a create. Done in a
     * transaction: a crash between the two halves would otherwise either lose
     * the unit or leave the catalogue showing it twice.
     */
    await documents.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: TABLES.vehicles, Key: { id } } },
          {
            Put: {
              TableName: TABLES.vehicles,
              Item: vehicle,
              ConditionExpression: "attribute_not_exists(id)",
            },
          },
        ],
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await documents.send(new DeleteCommand({ TableName: TABLES.vehicles, Key: { id } }));
  }
}

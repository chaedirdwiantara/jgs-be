import type { Vehicle } from "./vehicle.js";

export interface VehicleRepository {
  list(): Promise<Vehicle[]>;
  findById(id: string): Promise<Vehicle | null>;
  /** Rejects with a `conflict` DomainError when the slug is taken. */
  create(vehicle: Vehicle): Promise<void>;
  /** Replaces the record wholesale; the console always sends every field. */
  replace(id: string, vehicle: Vehicle): Promise<void>;
  remove(id: string): Promise<void>;
}

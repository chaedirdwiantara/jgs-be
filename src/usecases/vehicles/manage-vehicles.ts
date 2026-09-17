import { ConflictError, NotFoundError } from "../../domain/shared/errors.js";
import type { Vehicle } from "../../domain/vehicle/vehicle.js";
import type { VehicleRepository } from "../../domain/vehicle/vehicle-repository.js";

type Deps = { vehicles: VehicleRepository };

/** Public: the catalogue is what the site shows, so anyone may read it. */
export function makeListVehicles(deps: Deps) {
  return async function listVehicles(): Promise<Vehicle[]> {
    return deps.vehicles.list();
  };
}

export function makeCreateVehicle(deps: Deps) {
  return async function createVehicle(vehicle: Vehicle): Promise<Vehicle> {
    if (await deps.vehicles.findById(vehicle.id)) {
      throw ConflictError(`Kode unit "${vehicle.id}" sudah dipakai.`);
    }
    await deps.vehicles.create(vehicle);
    return vehicle;
  };
}

export function makeUpdateVehicle(deps: Deps) {
  return async function updateVehicle(id: string, vehicle: Vehicle): Promise<Vehicle> {
    const existing = await deps.vehicles.findById(id);
    if (!existing) throw NotFoundError("Unit tidak ditemukan.");

    // The console allows renaming the slug, which is also the key: that is a
    // delete-then-create, and the new slug must be free.
    if (vehicle.id !== id && (await deps.vehicles.findById(vehicle.id))) {
      throw ConflictError(`Kode unit "${vehicle.id}" sudah dipakai.`);
    }

    await deps.vehicles.replace(id, vehicle);
    return vehicle;
  };
}

export function makeDeleteVehicle(deps: Deps) {
  return async function deleteVehicle(id: string): Promise<void> {
    const existing = await deps.vehicles.findById(id);
    if (!existing) throw NotFoundError("Unit tidak ditemukan.");
    await deps.vehicles.remove(id);
  };
}

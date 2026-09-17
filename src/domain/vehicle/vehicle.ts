/**
 * Fleet catalogue.
 *
 * ⚠️ This shape is a published contract: the admin console in `chaedirdwiantara/jgs`
 * (`src/data/vehicles.ts` and `src/features/admin/schema.ts`) speaks exactly this
 * JSON. Changing a field name here breaks that console until it is rebuilt.
 *
 * `transferRate` was removed in Aug 2026 along with the airport transfer
 * service — do not reintroduce it.
 */

export const VEHICLE_TIERS = ["economy", "premium", "elite"] as const;

export type VehicleTier = (typeof VEHICLE_TIERS)[number];

export type FleetPhotoPair = {
  wide: string;
  tall: string;
};

export type Vehicle = {
  /** Lowercase slug, e.g. `byd-seal`. Doubles as the primary key. */
  id: string;
  name: string;
  tier: VehicleTier;
  seats: number;
  luggage: number;
  rangeKm: number;
  /** IDR, before PPN. */
  dailyRate: number;
  monthlyRate: number;
  downtimeRate: number;
  highlights: string[];
  photos: {
    outdoor: FleetPhotoPair;
    studio: FleetPhotoPair;
  };
};

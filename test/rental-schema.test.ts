import { describe, expect, it } from "vitest";

import { rentalSchema } from "../src/http/schemas.js";

const valid = {
  customerName: "Budi Santoso",
  customerPhone: "0811 803 0900",
  vehicleId: "byd-seal",
  vehicleLabel: "BYD Seal",
  plateNumber: "b 1234 xyz",
  startDate: "2026-09-17",
  startTime: "09:00",
  durationDays: 3,
  dailyRate: 750000,
  paymentStatus: "belum_dibayar",
  paymentDueDate: "2026-09-17",
};

describe("rentalSchema", () => {
  it("normalises the phone and the plate, and defaults the optional text", () => {
    const parsed = rentalSchema.parse(valid);

    expect(parsed.customerPhone).toBe("628118030900");
    expect(parsed.plateNumber).toBe("B1234XYZ");
    expect(parsed.notes).toBe("");
  });

  it("accepts an unassigned plate", () => {
    expect(rentalSchema.parse({ ...valid, plateNumber: "" }).plateNumber).toBe("");
    expect(rentalSchema.parse({ ...valid, plateNumber: undefined }).plateNumber).toBe("");
  });

  it("rejects a date that does not exist and a duration past the ceiling", () => {
    expect(rentalSchema.safeParse({ ...valid, startDate: "2026-02-31" }).success).toBe(false);
    expect(rentalSchema.safeParse({ ...valid, durationDays: 91 }).success).toBe(false);
    expect(rentalSchema.safeParse({ ...valid, durationDays: 0 }).success).toBe(false);
  });

  it("names the field in Indonesian when something is missing", () => {
    const result = rentalSchema.safeParse({ ...valid, customerName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["customerName"]);
      expect(result.error.issues[0]?.message).toBe("Nama penyewa minimal 2 karakter");
    }
  });
});

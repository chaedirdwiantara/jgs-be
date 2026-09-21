import { vi } from "vitest";

import type { ChatNotifier } from "../src/domain/notification/chat-notifier.js";
import { EMPTY_LEDGER, type Rental, type RentalDetails } from "../src/domain/rental/rental.js";
import type { RentalRepository } from "../src/domain/rental/rental-repository.js";
import { rentalEndDate } from "../src/domain/shared/dates.js";

export function baseDetails(overrides: Partial<RentalDetails> = {}): RentalDetails {
  return {
    customerName: "Budi Santoso",
    customerPhone: "628118030900",
    vehicleId: "byd-seal",
    vehicleLabel: "BYD Seal",
    plateNumber: "B1234XYZ",
    startDate: "2026-09-17",
    startTime: "09:00",
    durationDays: 3,
    dailyRate: 750_000,
    paymentStatus: "belum_dibayar",
    paymentDueDate: "2026-09-17",
    notes: "",
    ...overrides,
  };
}

export function baseRental(overrides: Partial<Rental> = {}): Rental {
  const details = baseDetails();
  return {
    ...details,
    id: "rental-1",
    endDate: rentalEndDate(details.startDate, details.durationDays),
    paidAt: null,
    reminders: EMPTY_LEDGER,
    createdAt: "2026-09-10T02:00:00.000Z",
    createdBy: "Siti",
    updatedAt: "2026-09-10T02:00:00.000Z",
    ...overrides,
  };
}

/**
 * An in-memory `RentalRepository` faithful enough for the use cases: the
 * queries are computed from the same fields the DynamoDB indexes key on.
 */
export function memoryRentals(seed: Rental[] = []) {
  const store = new Map(seed.map((rental) => [rental.id, rental]));

  const repository: RentalRepository = {
    listOverlapping: async (from, to) =>
      [...store.values()].filter((r) => r.startDate <= to && r.endDate >= from),
    listStartingOn: async (date) => [...store.values()].filter((r) => r.startDate === date),
    listEndingOn: async (date) => [...store.values()].filter((r) => r.endDate === date),
    listUnpaidDueBefore: async (date) =>
      [...store.values()].filter(
        (r) => r.paymentStatus === "belum_dibayar" && r.paymentDueDate < date,
      ),
    findById: async (id) => store.get(id) ?? null,
    create: async (rental) => void store.set(rental.id, rental),
    replace: async (rental) => void store.set(rental.id, rental),
    stampReminder: async (id, key, sentOn) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`no rental ${id}`);
      store.set(id, { ...existing, reminders: { ...existing.reminders, [key]: sentOn } });
    },
    remove: async (id) => void store.delete(id),
  };

  return { repository, store };
}

export function recordingChat() {
  const sent: string[] = [];
  const chat: ChatNotifier = { send: vi.fn(async (message: string) => void sent.push(message)) };
  return { chat, sent };
}
